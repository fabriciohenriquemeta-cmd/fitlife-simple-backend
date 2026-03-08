const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fitlife_secret_key_2026';

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ==================== AUTO CREATE TABLES ====================
async function initializeDatabase() {
  try {
    // Criar tabela user_data se não existir
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS loads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        exercise VARCHAR(255) NOT NULL,
        sets INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        weight DECIMAL(6,2) NOT NULL,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_data (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Criar índices se não existirem
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_loads_user_id ON loads(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_data_user_id ON user_data(user_id)`);
    
    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
  }
}

// Test database connection and initialize
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection error:', err);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
    initializeDatabase();
  }
});

// ==================== AUTH MIDDLEWARE ====================
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// ==================== ROOT ENDPOINT ====================
app.get('/', (req, res) => {
  res.json({
    message: '🏋️ FitLife Pro API - v2.1 com Sync',
    version: '2.1.0',
    endpoints: {
      auth: '/api/auth',
      loads: '/api/loads',
      data: '/api/data',
      stats: '/api/stats'
    }
  });
});

// ==================== AUTH ENDPOINTS ====================

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }

    const userExists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, hashedPassword]
    );

    const user = result.rows[0];

    // Criar registro vazio em user_data
    await pool.query(
      'INSERT INTO user_data (user_id, data) VALUES ($1, $2)',
      [user.id, JSON.stringify({})]
    );

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      message: 'Login realizado com sucesso',
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// Get current user
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

// ==================== DATA SYNC ENDPOINTS ====================

// Sincronizar dados (salvar)
app.post('/api/data/sync', authMiddleware, async (req, res) => {
  try {
    const { data } = req.body;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Dados inválidos' });
    }

    data.lastSyncedAt = new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO user_data (user_id, data)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET data = $2, updated_at = CURRENT_TIMESTAMP
      RETURNING id, updated_at
    `, [req.userId, JSON.stringify(data)]);

    console.log(`✅ Dados sincronizados para user ${req.userId}`);

    res.json({
      success: true,
      message: 'Dados sincronizados com sucesso',
      syncedAt: result.rows[0].updated_at
    });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Erro ao sincronizar dados' });
  }
});

// Carregar dados
app.get('/api/data', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT data, updated_at FROM user_data WHERE user_id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        data: {},
        lastSyncedAt: null,
        message: 'Nenhum dado encontrado'
      });
    }

    res.json({
      data: result.rows[0].data,
      lastSyncedAt: result.rows[0].updated_at
    });
  } catch (error) {
    console.error('Load data error:', error);
    res.status(500).json({ error: 'Erro ao carregar dados' });
  }
});

// ==================== LOADS ENDPOINTS ====================

app.get('/api/loads', authMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await pool.query(
      'SELECT * FROM loads WHERE user_id = $1 ORDER BY date DESC LIMIT $2',
      [req.userId, limit]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get loads error:', error);
    res.status(500).json({ error: 'Erro ao buscar cargas' });
  }
});

app.post('/api/loads', authMiddleware, async (req, res) => {
  try {
    const { exercise, sets, reps, weight, date, notes } = req.body;

    if (!exercise || !sets || !reps || weight === undefined) {
      return res.status(400).json({ error: 'Exercício, séries, reps e carga são obrigatórios' });
    }

    const result = await pool.query(
      'INSERT INTO loads (user_id, exercise, sets, reps, weight, date, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [req.userId, exercise, sets, reps, weight, date || new Date(), notes || null]
    );

    res.status(201).json({
      message: 'Carga adicionada com sucesso',
      load: result.rows[0]
    });
  } catch (error) {
    console.error('Create load error:', error);
    res.status(500).json({ error: 'Erro ao adicionar carga' });
  }
});

app.delete('/api/loads/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM loads WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Carga não encontrada' });
    }

    res.json({ message: 'Carga excluída com sucesso' });
  } catch (error) {
    console.error('Delete load error:', error);
    res.status(500).json({ error: 'Erro ao excluir carga' });
  }
});

// ==================== STATS ENDPOINT ====================

app.get('/api/stats/dashboard', authMiddleware, async (req, res) => {
  try {
    const workoutsResult = await pool.query(
      'SELECT COUNT(DISTINCT DATE(date)) as count FROM loads WHERE user_id = $1',
      [req.userId]
    );

    const exercisesResult = await pool.query(
      'SELECT COUNT(DISTINCT exercise) as count FROM loads WHERE user_id = $1',
      [req.userId]
    );

    const volumeResult = await pool.query(
      'SELECT COALESCE(SUM(sets * reps * weight), 0) as total FROM loads WHERE user_id = $1',
      [req.userId]
    );

    const recentResult = await pool.query(
      'SELECT COUNT(DISTINCT DATE(date)) as count FROM loads WHERE user_id = $1 AND date >= NOW() - INTERVAL \'7 days\'',
      [req.userId]
    );

    res.json({
      totalWorkouts: parseInt(workoutsResult.rows[0].count) || 0,
      totalExercises: parseInt(exercisesResult.rows[0].count) || 0,
      totalVolume: parseFloat(volumeResult.rows[0].total) || 0,
      recentWorkouts: parseInt(recentResult.rows[0].count) || 0
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== WATCH PAIRING ENDPOINTS ====================

// Armazenamento temporário dos códigos de pareamento (em produção usar Redis)
const pairCodes = new Map(); // code -> { userId, token, expiresAt, confirmed }

// 1. Watch solicita código de pareamento (sem autenticação)
app.post('/api/auth/pair/request', async (req, res) => {
  try {
    // Gerar código de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // expira em 5 minutos

    pairCodes.set(code, {
      userId: null,
      token: null,
      expiresAt,
      confirmed: false
    });

    // Limpar códigos expirados
    for (const [k, v] of pairCodes.entries()) {
      if (Date.now() > v.expiresAt) pairCodes.delete(k);
    }

    console.log(`⌚ Pair code requested: ${code}`);

    res.json({
      code,
      expiresAt,
      message: 'Escaneie o QR Code com o app FitLife Pro'
    });
  } catch (error) {
    console.error('Pair request error:', error);
    res.status(500).json({ error: 'Erro ao gerar código' });
  }
});

// 2. Phone confirma o pareamento (requer JWT do phone)
app.post('/api/auth/pair/confirm', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Código obrigatório' });
    }

    const pairData = pairCodes.get(code);

    if (!pairData) {
      return res.status(404).json({ error: 'Código inválido ou expirado' });
    }

    if (Date.now() > pairData.expiresAt) {
      pairCodes.delete(code);
      return res.status(400).json({ error: 'Código expirado' });
    }

    if (pairData.confirmed) {
      return res.status(400).json({ error: 'Código já utilizado' });
    }

    // Buscar dados do usuário
    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    // Gerar token especial para o Watch (30 dias)
    const watchToken = jwt.sign({ userId: user.id, device: 'watch' }, JWT_SECRET, { expiresIn: '30d' });

    // Marcar como confirmado
    pairCodes.set(code, {
      ...pairData,
      userId: user.id,
      token: watchToken,
      user: { id: user.id, name: user.name, email: user.email },
      confirmed: true
    });

    console.log(`✅ Watch paired for user: ${user.email}`);

    res.json({
      message: 'Watch pareado com sucesso!',
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    console.error('Pair confirm error:', error);
    res.status(500).json({ error: 'Erro ao confirmar pareamento' });
  }
});

// 3. Watch verifica se foi confirmado (polling)
app.get('/api/auth/pair/status/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const pairData = pairCodes.get(code);

    if (!pairData) {
      return res.status(404).json({ status: 'expired', error: 'Código inválido ou expirado' });
    }

    if (Date.now() > pairData.expiresAt) {
      pairCodes.delete(code);
      return res.status(400).json({ status: 'expired', error: 'Código expirado' });
    }

    if (!pairData.confirmed) {
      const remaining = Math.floor((pairData.expiresAt - Date.now()) / 1000);
      return res.json({ status: 'pending', remainingSeconds: remaining });
    }

    // Confirmado! Retornar token e apagar código
    const response = {
      status: 'confirmed',
      token: pairData.token,
      user: pairData.user
    };
    pairCodes.delete(code); // usar só uma vez

    res.json(response);
  } catch (error) {
    console.error('Pair status error:', error);
    res.status(500).json({ error: 'Erro ao verificar status' });
  }
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});
