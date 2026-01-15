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
app.use(express.json());

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection error:', err);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
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
    message: '🏋️ FitLife Pro API - Simple Edition',
    version: '2.0.0',
    endpoints: {
      auth: '/api/auth',
      loads: '/api/loads'
    }
  });
});

// ==================== AUTH ENDPOINTS ====================

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }

    // Check if user exists
    const userExists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'Email já cadastrado' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, hashedPassword]
    );

    const user = result.rows[0];

    // Generate token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
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

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    // Find user
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const user = result.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    // Generate token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      message: 'Login realizado com sucesso',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
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

// ==================== LOADS ENDPOINTS ====================

// Get loads
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

// Create load
app.post('/api/loads', authMiddleware, async (req, res) => {
  try {
    const { exercise, sets, reps, weight, date } = req.body;

    // Validate input
    if (!exercise || !sets || !reps || weight === undefined) {
      return res.status(400).json({ error: 'Exercício, séries, reps e carga são obrigatórios' });
    }

    const result = await pool.query(
      'INSERT INTO loads (user_id, exercise, sets, reps, weight, date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.userId, exercise, sets, reps, weight, date || new Date()]
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

// Delete load
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

// Get dashboard stats
app.get('/api/stats/dashboard', authMiddleware, async (req, res) => {
  try {
    // Total workouts (distinct dates)
    const workoutsResult = await pool.query(
      'SELECT COUNT(DISTINCT DATE(date)) as count FROM loads WHERE user_id = $1',
      [req.userId]
    );

    // Total exercises (distinct exercise names)
    const exercisesResult = await pool.query(
      'SELECT COUNT(DISTINCT exercise) as count FROM loads WHERE user_id = $1',
      [req.userId]
    );

    // Total volume (sum of sets * reps * weight)
    const volumeResult = await pool.query(
      'SELECT COALESCE(SUM(sets * reps * weight), 0) as total FROM loads WHERE user_id = $1',
      [req.userId]
    );

    // Recent workouts (last 7 days)
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

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});
