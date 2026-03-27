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

    // ── NOVAS TABELAS: SISTEMA DE AFILIADOS ──────────────────

    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliates (
        id               SERIAL PRIMARY KEY,
        user_id          INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        coupon_code      VARCHAR(20) NOT NULL UNIQUE,
        status           VARCHAR(20) DEFAULT 'active',
        total_earned     DECIMAL(10,2) DEFAULT 0.00,
        total_withdrawn  DECIMAL(10,2) DEFAULT 0.00,
        balance          DECIMAL(10,2) DEFAULT 0.00,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_conversions (
        id                SERIAL PRIMARY KEY,
        affiliate_id      INTEGER NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
        new_user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subscription_id   VARCHAR(100),
        original_price    DECIMAL(10,2) NOT NULL,
        discount_applied  DECIMAL(10,2) NOT NULL,
        price_paid        DECIMAL(10,2) NOT NULL,
        commission_amount DECIMAL(10,2) NOT NULL,
        status            VARCHAR(20) DEFAULT 'pending',
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_withdrawals (
        id              SERIAL PRIMARY KEY,
        affiliate_id    INTEGER NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
        amount          DECIMAL(10,2) NOT NULL,
        pix_key         VARCHAR(150) NOT NULL,
        pix_key_type    VARCHAR(20) NOT NULL,
        status          VARCHAR(20) DEFAULT 'requested',
        notes           TEXT,
        requested_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at    TIMESTAMP
      )
    `);

    // ── ÍNDICES ──────────────────────────────────────────────

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_loads_user_id ON loads(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_data_user_id ON user_data(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_affiliates_user_id ON affiliates(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_affiliates_coupon ON affiliates(coupon_code)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversions_affiliate ON affiliate_conversions(affiliate_id)`);

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
    if (!token) return res.status(401).json({ error: 'Token não fornecido' });
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
    message: '🏋️ FitLife Pro API - v2.2 com Afiliados',
    version: '2.2.0',
    endpoints: {
      auth: '/api/auth',
      loads: '/api/loads',
      data: '/api/data',
      stats: '/api/stats',
      affiliates: '/api/affiliates'
    }
  });
});

// ==================== AUTH ENDPOINTS ====================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });

    if (password.length < 6)
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });

    const userExists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0)
      return res.status(400).json({ error: 'Email já cadastrado' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, hashedPassword]
    );
    const user = result.rows[0];

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

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0)
      return res.status(401).json({ error: 'Email ou senha incorretos' });

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword)
      return res.status(401).json({ error: 'Email ou senha incorretos' });

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

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

// ==================== DATA SYNC ENDPOINTS ====================

app.post('/api/data/sync', authMiddleware, async (req, res) => {
  try {
    const { data } = req.body;
    if (!data || typeof data !== 'object')
      return res.status(400).json({ error: 'Dados inválidos' });

    data.lastSyncedAt = new Date().toISOString();
    const result = await pool.query(`
      INSERT INTO user_data (user_id, data) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET data = $2, updated_at = CURRENT_TIMESTAMP
      RETURNING id, updated_at
    `, [req.userId, JSON.stringify(data)]);

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

app.get('/api/data', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT data, updated_at FROM user_data WHERE user_id = $1',
      [req.userId]
    );
    if (result.rows.length === 0)
      return res.json({ data: {}, lastSyncedAt: null, message: 'Nenhum dado encontrado' });
    res.json({ data: result.rows[0].data, lastSyncedAt: result.rows[0].updated_at });
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
    res.status(500).json({ error: 'Erro ao buscar cargas' });
  }
});

app.post('/api/loads', authMiddleware, async (req, res) => {
  try {
    const { exercise, sets, reps, weight, date, notes } = req.body;
    if (!exercise || !sets || !reps || weight === undefined)
      return res.status(400).json({ error: 'Exercício, séries, reps e carga são obrigatórios' });

    const result = await pool.query(
      'INSERT INTO loads (user_id, exercise, sets, reps, weight, date, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.userId, exercise, sets, reps, weight, date || new Date(), notes || null]
    );
    res.status(201).json({ message: 'Carga adicionada com sucesso', load: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao adicionar carga' });
  }
});

app.delete('/api/loads/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM loads WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Carga não encontrada' });
    res.json({ message: 'Carga excluída com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir carga' });
  }
});

// ==================== STATS ENDPOINT ====================

app.get('/api/stats/dashboard', authMiddleware, async (req, res) => {
  try {
    const [workouts, exercises, volume, recent] = await Promise.all([
      pool.query('SELECT COUNT(DISTINCT DATE(date)) as count FROM loads WHERE user_id = $1', [req.userId]),
      pool.query('SELECT COUNT(DISTINCT exercise) as count FROM loads WHERE user_id = $1', [req.userId]),
      pool.query('SELECT COALESCE(SUM(sets * reps * weight), 0) as total FROM loads WHERE user_id = $1', [req.userId]),
      pool.query("SELECT COUNT(DISTINCT DATE(date)) as count FROM loads WHERE user_id = $1 AND date >= NOW() - INTERVAL '7 days'", [req.userId])
    ]);
    res.json({
      totalWorkouts: parseInt(workouts.rows[0].count) || 0,
      totalExercises: parseInt(exercises.rows[0].count) || 0,
      totalVolume: parseFloat(volume.rows[0].total) || 0,
      recentWorkouts: parseInt(recent.rows[0].count) || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

// ==================== WATCH PAIRING ENDPOINTS ====================

const pairCodes = new Map();

app.post('/api/auth/pair/request', async (req, res) => {
  try {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;
    pairCodes.set(code, { userId: null, token: null, expiresAt, confirmed: false });
    for (const [k, v] of pairCodes.entries()) {
      if (Date.now() > v.expiresAt) pairCodes.delete(k);
    }
    res.json({ code, expiresAt, message: 'Escaneie o QR Code com o app FitLife Pro' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar código' });
  }
});

app.post('/api/auth/pair/confirm', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código obrigatório' });

    const pairData = pairCodes.get(code);
    if (!pairData) return res.status(404).json({ error: 'Código inválido ou expirado' });
    if (Date.now() > pairData.expiresAt) { pairCodes.delete(code); return res.status(400).json({ error: 'Código expirado' }); }
    if (pairData.confirmed) return res.status(400).json({ error: 'Código já utilizado' });

    const result = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

    const user = result.rows[0];
    const watchToken = jwt.sign({ userId: user.id, device: 'watch' }, JWT_SECRET, { expiresIn: '30d' });
    pairCodes.set(code, { ...pairData, userId: user.id, token: watchToken, user: { id: user.id, name: user.name, email: user.email }, confirmed: true });

    res.json({ message: 'Watch pareado com sucesso!', user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao confirmar pareamento' });
  }
});

app.get('/api/auth/pair/status/:code', async (req, res) => {
  try {
    const pairData = pairCodes.get(req.params.code);
    if (!pairData) return res.status(404).json({ status: 'expired', error: 'Código inválido ou expirado' });
    if (Date.now() > pairData.expiresAt) { pairCodes.delete(req.params.code); return res.status(400).json({ status: 'expired', error: 'Código expirado' }); }
    if (!pairData.confirmed) return res.json({ status: 'pending', remainingSeconds: Math.floor((pairData.expiresAt - Date.now()) / 1000) });

    const response = { status: 'confirmed', token: pairData.token, user: pairData.user };
    pairCodes.delete(req.params.code);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao verificar status' });
  }
});

// ==================== AFILIADOS ====================

// Helper: gerar cupom único a partir do nome do usuário
function generateCouponCode(name) {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const suffix = Math.floor(100 + Math.random() * 900);
  return `${base}${suffix}`; // ex: JOAO123
}

// POST /api/affiliates/register
// Ativa o programa de afiliado para o usuário logado
app.post('/api/affiliates/register', authMiddleware, async (req, res) => {
  try {
    // Verificar se já é afiliado
    const existing = await pool.query(
      'SELECT id, coupon_code FROM affiliates WHERE user_id = $1',
      [req.userId]
    );
    if (existing.rows.length > 0) {
      return res.json({
        success: true,
        coupon_code: existing.rows[0].coupon_code,
        already_registered: true
      });
    }

    // Buscar nome do usuário para gerar o cupom
    const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [req.userId]);
    const userName = userResult.rows[0]?.name || 'USER';

    // Garantir cupom único (até 10 tentativas)
    let couponCode;
    for (let i = 0; i < 10; i++) {
      couponCode = generateCouponCode(userName);
      const check = await pool.query('SELECT id FROM affiliates WHERE coupon_code = $1', [couponCode]);
      if (check.rows.length === 0) break;
    }

    await pool.query(
      'INSERT INTO affiliates (user_id, coupon_code) VALUES ($1, $2)',
      [req.userId, couponCode]
    );

    console.log(`✅ Afiliado registrado: user ${req.userId} → cupom ${couponCode}`);
    res.json({ success: true, coupon_code: couponCode });
  } catch (error) {
    console.error('Affiliate register error:', error);
    res.status(500).json({ error: 'Erro ao registrar afiliado' });
  }
});

// GET /api/affiliates/me
// Retorna painel completo do afiliado logado
app.get('/api/affiliates/me', authMiddleware, async (req, res) => {
  try {
    const affiliate = await pool.query(
      'SELECT * FROM affiliates WHERE user_id = $1',
      [req.userId]
    );
    if (affiliate.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não é afiliado' });
    }

    const aff = affiliate.rows[0];

    // Estatísticas dos últimos 30 dias
    const stats = await pool.query(`
      SELECT
        COUNT(*) AS total_referrals,
        COALESCE(SUM(commission_amount), 0) AS earned_30d
      FROM affiliate_conversions
      WHERE affiliate_id = $1
        AND status = 'confirmed'
        AND created_at > NOW() - INTERVAL '30 days'
    `, [aff.id]);

    // Histórico das últimas 10 indicações
    const history = await pool.query(`
      SELECT
        ac.created_at,
        ac.price_paid,
        ac.commission_amount,
        ac.status,
        u.name AS referred_user_name
      FROM affiliate_conversions ac
      JOIN users u ON u.id = ac.new_user_id
      WHERE ac.affiliate_id = $1
      ORDER BY ac.created_at DESC
      LIMIT 10
    `, [aff.id]);

    res.json({
      coupon_code: aff.coupon_code,
      status: aff.status,
      balance: parseFloat(aff.balance),
      total_earned: parseFloat(aff.total_earned),
      total_withdrawn: parseFloat(aff.total_withdrawn),
      stats_30d: {
        total_referrals: parseInt(stats.rows[0].total_referrals),
        earned_30d: parseFloat(stats.rows[0].earned_30d)
      },
      history: history.rows
    });
  } catch (error) {
    console.error('Affiliate me error:', error);
    res.status(500).json({ error: 'Erro ao buscar dados do afiliado' });
  }
});

// POST /api/affiliates/validate-coupon
// Valida um cupom no checkout — endpoint público (sem auth)
app.post('/api/affiliates/validate-coupon', async (req, res) => {
  try {
    const { coupon_code } = req.body;
    if (!coupon_code) return res.status(400).json({ error: 'Código não informado' });

    const result = await pool.query(`
      SELECT a.id, a.coupon_code, a.status, u.name AS owner_name
      FROM affiliates a
      JOIN users u ON u.id = a.user_id
      WHERE UPPER(a.coupon_code) = UPPER($1) AND a.status = 'active'
    `, [coupon_code]);

    if (result.rows.length === 0) {
      return res.json({ valid: false, message: 'Cupom inválido ou inativo' });
    }

    const aff = result.rows[0];
    res.json({
      valid: true,
      coupon_code: aff.coupon_code,
      owner_name: aff.owner_name,
      discount_percent: 20,
      message: `Cupom de ${aff.owner_name} aplicado! Você tem 20% de desconto. 🎉`
    });
  } catch (error) {
    console.error('Validate coupon error:', error);
    res.status(500).json({ error: 'Erro ao validar cupom' });
  }
});

// POST /api/affiliates/register-conversion
// Chamado após pagamento confirmado pelo gateway (webhook)
// Proteja com um secret fixo em produção: req.headers['x-webhook-secret']
app.post('/api/affiliates/register-conversion', async (req, res) => {
  try {
    const { coupon_code, new_user_id, subscription_id, original_price, price_paid } = req.body;

    if (!coupon_code || !new_user_id || !original_price || !price_paid) {
      return res.status(400).json({ error: 'Dados incompletos para registrar conversão' });
    }

    const affiliate = await pool.query(
      'SELECT id FROM affiliates WHERE UPPER(coupon_code) = UPPER($1)',
      [coupon_code]
    );
    if (affiliate.rows.length === 0)
      return res.status(404).json({ error: 'Afiliado não encontrado para esse cupom' });

    const affId = affiliate.rows[0].id;
    const discountApplied = parseFloat((original_price - price_paid).toFixed(2));
    const commissionAmount = parseFloat((price_paid * 0.20).toFixed(2));

    // Anti-fraude: um usuário só pode gerar comissão uma vez por afiliado
    const dupCheck = await pool.query(
      'SELECT id FROM affiliate_conversions WHERE affiliate_id = $1 AND new_user_id = $2',
      [affId, new_user_id]
    );
    if (dupCheck.rows.length > 0) {
      return res.json({ success: false, message: 'Conversão já registrada para este usuário' });
    }

    await pool.query(`
      INSERT INTO affiliate_conversions
        (affiliate_id, new_user_id, subscription_id, original_price, discount_applied, price_paid, commission_amount, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed')
    `, [affId, new_user_id, subscription_id || null, original_price, discountApplied, price_paid, commissionAmount]);

    // Creditar saldo do afiliado
    await pool.query(`
      UPDATE affiliates
      SET balance = balance + $1, total_earned = total_earned + $1
      WHERE id = $2
    `, [commissionAmount, affId]);

    console.log(`💰 Comissão de R$${commissionAmount} creditada para afiliado ${affId}`);
    res.json({ success: true, commission_credited: commissionAmount });
  } catch (error) {
    console.error('Register conversion error:', error);
    res.status(500).json({ error: 'Erro ao registrar conversão' });
  }
});

// POST /api/affiliates/withdraw
// Solicita saque do saldo via Pix
app.post('/api/affiliates/withdraw', authMiddleware, async (req, res) => {
  try {
    const { amount, pix_key, pix_key_type } = req.body;

    if (!amount || parseFloat(amount) < 20) {
      return res.status(400).json({ error: 'Valor mínimo para saque é R$20,00' });
    }
    if (!pix_key_type || !pix_key) {
      return res.status(400).json({ error: 'Chave Pix e tipo são obrigatórios' });
    }

    const affiliate = await pool.query(
      'SELECT id, balance FROM affiliates WHERE user_id = $1',
      [req.userId]
    );
    if (affiliate.rows.length === 0)
      return res.status(404).json({ error: 'Usuário não é afiliado' });

    const aff = affiliate.rows[0];
    if (parseFloat(aff.balance) < parseFloat(amount)) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    // Deduzir saldo e registrar pedido
    await pool.query(
      'UPDATE affiliates SET balance = balance - $1, total_withdrawn = total_withdrawn + $1 WHERE id = $2',
      [amount, aff.id]
    );
    await pool.query(`
      INSERT INTO affiliate_withdrawals (affiliate_id, amount, pix_key, pix_key_type)
      VALUES ($1, $2, $3, $4)
    `, [aff.id, amount, pix_key, pix_key_type]);

    console.log(`💸 Saque de R$${amount} solicitado por afiliado ${aff.id}`);

    // TODO: Aqui você conecta com o gateway (Pagar.me, Iugu, etc.)
    // para fazer a transferência Pix automática

    res.json({
      success: true,
      message: 'Saque solicitado com sucesso! Será processado em até 2 dias úteis.'
    });
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: 'Erro ao solicitar saque' });
  }
});

// GET /api/affiliates/withdrawals
// Histórico de saques do afiliado logado
app.get('/api/affiliates/withdrawals', authMiddleware, async (req, res) => {
  try {
    const affiliate = await pool.query(
      'SELECT id FROM affiliates WHERE user_id = $1',
      [req.userId]
    );
    if (affiliate.rows.length === 0)
      return res.status(404).json({ error: 'Usuário não é afiliado' });

    const result = await pool.query(`
      SELECT amount, pix_key_type, status, requested_at, processed_at
      FROM affiliate_withdrawals
      WHERE affiliate_id = $1
      ORDER BY requested_at DESC
      LIMIT 20
    `, [affiliate.rows[0].id]);

    res.json({ withdrawals: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar histórico de saques' });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});
