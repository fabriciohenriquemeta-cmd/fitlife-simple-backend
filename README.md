# 🏋️ FitLife Pro - Simple Backend

Backend minimalista sem ORM - apenas Node.js + Express + PostgreSQL puro.

## ✅ Características

- ✅ **Simples:** 1 arquivo, 300 linhas
- ✅ **Rápido:** Sem ORM, SQL direto
- ✅ **Funcional:** 4 endpoints essenciais
- ✅ **Seguro:** JWT + bcrypt

---

## 📦 Instalação

### 1. Instalar dependências
```bash
npm install
```

### 2. Configurar PostgreSQL
Execute o arquivo `init.sql` no seu banco:
```bash
psql "postgresql://user:password@host/database" -f init.sql
```

### 3. Configurar variáveis de ambiente
```bash
# Render.com
DATABASE_URL=postgresql://user:password@host/database
JWT_SECRET=seu_secret_key_aqui
NODE_ENV=production
PORT=3001
```

### 4. Iniciar servidor
```bash
npm start
```

---

## 🔗 Endpoints

### Base URL
```
https://your-app.onrender.com
```

### Autenticação

#### POST /api/auth/register
Criar nova conta
```json
{
  "name": "João Silva",
  "email": "joao@gmail.com",
  "password": "senha123"
}
```

#### POST /api/auth/login
Fazer login
```json
{
  "email": "joao@gmail.com",
  "password": "senha123"
}
```

#### GET /api/auth/me
Buscar usuário atual (requer token)
```
Authorization: Bearer {token}
```

### Cargas

#### GET /api/loads?limit=50
Listar cargas do usuário (requer token)

#### POST /api/loads
Adicionar nova carga (requer token)
```json
{
  "exercise": "Supino Reto",
  "sets": 4,
  "reps": 10,
  "weight": 80.5,
  "date": "2026-01-15T14:30:00Z"
}
```

#### DELETE /api/loads/:id
Excluir carga (requer token)

### Estatísticas

#### GET /api/stats/dashboard
Buscar estatísticas do dashboard (requer token)

Retorna:
```json
{
  "totalWorkouts": 45,
  "totalExercises": 15,
  "totalVolume": 125000,
  "recentWorkouts": 5
}
```

---

## 🚀 Deploy no Render.com

### 1. Criar PostgreSQL Database
- Vá em: https://dashboard.render.com
- Clique em **"New +"** → **"PostgreSQL"**
- Nome: `fitlife-simple-db`
- Região: **Oregon (US West)**
- Plano: **Free**
- Clique em **"Create Database"**

### 2. Executar SQL
- Abra o banco criado
- Copie a **External Database URL**
- No Terminal:
```bash
psql "URL_DO_BANCO" -f init.sql
```

### 3. Criar Web Service
- Clique em **"New +"** → **"Web Service"**
- Conecte seu GitHub
- Selecione o repositório
- Configurações:
  - **Name:** fitlife-simple-backend
  - **Region:** Oregon (US West)
  - **Branch:** main
  - **Root Directory:** (vazio)
  - **Build Command:** `npm install`
  - **Start Command:** `npm start`

### 4. Adicionar Environment Variables
- `DATABASE_URL`: Cole a External Database URL
- `JWT_SECRET`: Crie uma chave aleatória longa
- `NODE_ENV`: production
- `PORT`: 3001

### 5. Deploy
- Clique em **"Create Web Service"**
- Aguarde o deploy (2-3 minutos)

---

## 🧪 Testar

### Health Check
```bash
curl https://your-app.onrender.com/
```

### Criar conta
```bash
curl -X POST https://your-app.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Teste","email":"teste@gmail.com","password":"senha123"}'
```

### Login
```bash
curl -X POST https://your-app.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@gmail.com","password":"senha123"}'
```

---

## 📊 Estrutura do Banco

### Tabela: users
- id (SERIAL PRIMARY KEY)
- name (VARCHAR)
- email (VARCHAR UNIQUE)
- password (VARCHAR - hashed)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)

### Tabela: loads
- id (SERIAL PRIMARY KEY)
- user_id (INTEGER FK)
- exercise (VARCHAR)
- sets (INTEGER)
- reps (INTEGER)
- weight (DECIMAL)
- date (TIMESTAMP)
- notes (TEXT)
- created_at (TIMESTAMP)

---

## 🔒 Segurança

- ✅ Senhas hasheadas com bcrypt (10 rounds)
- ✅ JWT com expiração de 30 dias
- ✅ Proteção contra SQL injection (parametrized queries)
- ✅ CORS habilitado
- ✅ Validação de inputs

---

## 🐛 Troubleshooting

### Erro: "Cannot connect to database"
- Verifique se DATABASE_URL está correto
- Certifique-se que o banco PostgreSQL está ativo

### Erro: "Token inválido"
- Verifique se o JWT_SECRET é o mesmo no servidor
- Certifique-se que o token não expirou

### Erro: "Email já cadastrado"
- Use um email diferente ou faça login

---

## 📝 Licença

MIT License - use como quiser!

---

## 💪 Contato

Criado com ❤️ para FitLife Pro
