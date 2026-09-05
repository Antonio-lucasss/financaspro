# 🌿 FinançasPro — Sistema de Controle Financeiro Pessoal

Um sistema moderno, rápido e completo para controle de finanças pessoais, cartões de crédito, contas bancárias, veículos e análises financeiras avançadas.

Construído com frontend nativo (Vanilla HTML5, CSS3 e JavaScript), backend Express.js preparado para Serverless na **Vercel**, e banco de dados relacional em nuvem no **Supabase (PostgreSQL)**.

---

## ✨ Funcionalidades

- 📊 **Dashboard Interativo**: Resumo de receitas, despesas, saldo acumulado, saldo futuro projetado e gráficos analíticos.
- 💸 **Gestão de Transações**: Lançamento de receitas e despesas com categorização, autocomplete inteligente e suporte a compras parceladas.
- 💳 **Cartões de Crédito**: Controle de limite total, limite utilizado e disponível, cálculo dinâmico de datas de fechamento e vencimento de faturas, parcelamentos futuros e pagamento de fatura integrado.
- 🏦 **Bancos e Contas**: Saldos em tempo real por instituição, transferências entre bancos e ajuste de saldo automático.
- 🚗 **Gestão Veicular**: Controle de veículos com histórico de custos, abastecimentos, manutenções, impostos e estatísticas de consumo.
- 🔄 **Transações Recorrentes**: Agendamento de despesas e receitas fixas (mensal, semanal, anual) com processamento automatizado.
- 📈 **Análises e Saúde Financeira**: Score de saúde financeira (0-100), taxa de poupança, taxa de queima (*burn rate*), comparação mês a mês e projeções futuras.

---

## 🛠️ Tecnologias

- **Frontend**: HTML5 Semântico, CSS3 Moderno (design responsivo, tema escuro refinado), Vanilla JavaScript ES6+, [Chart.js](https://www.chartjs.org/)
- **Backend**: [Node.js](https://nodejs.org/) & [Express.js](https://expressjs.com/) (compatível com Serverless Functions da Vercel)
- **Banco de Dados**: [Supabase](https://supabase.com/) (PostgreSQL 17 gerenciado na nuvem)
- **Conectividade**: Driver `pg` (com pool de conexões otimizado para Supabase Pooler) e `@supabase/supabase-js`
- **Deploy**: [Vercel](https://vercel.com/) (Serverless + CDN global) e Docker / Docker Compose

---

## 🚀 Como Fazer Deploy na Vercel

O FinançasPro está 100% configurado para rodar na Vercel através de Serverless Functions (`api/index.js`) e distribuição estática dos arquivos em `public/`.

### Passo a Passo:

1. **Importar o Repositório**:
   - Acesse o [Dashboard da Vercel](https://vercel.com/new).
   - Conecte sua conta do GitHub e importe o repositório `financaspro`.

2. **Configurar as Variáveis de Ambiente na Vercel**:
   Em **Settings > Environment Variables**, adicione:

   | Variável | Descrição | Exemplo |
   | :--- | :--- | :--- |
   | `SUPABASE_URL` | URL da API do seu projeto Supabase | `https://xxxx.supabase.co` |
   | `SUPABASE_ANON_KEY` | Chave pública anônima do Supabase | `sb_publishable_...` |
   | `DATABASE_URL` | String de conexão do Supabase Pooler (porta 5432 ou 6543) | `postgresql://user.ref:password@aws-0-sa-east-1.pooler.supabase.com:5432/postgres` |
   | `NODE_ENV` | Ambiente de execução | `production` |

3. **Deploy**:
   - Clique em **Deploy**.
   - A Vercel criará automaticamente o build e disponibilizará a URL de produção (ex.: `https://financaspro.vercel.app`).

---

## 💻 Executando Localmente

### Pré-requisitos
- Node.js 20+
- Um projeto configurado no Supabase (ou variáveis preenchidas no `.env`)

### Instalação

```bash
# Clone o repositório
git clone https://github.com/Antonio-lucasss/financaspro.git
cd financaspro

# Instale as dependências
npm install

# Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com suas credenciais do Supabase

# Inicie o servidor de desenvolvimento
npm run dev
# Ou em modo produção
npm start
```

O sistema estará acessível em `http://localhost:3000`.

---

## 🔒 Autenticação e Configuração Inicial da Senha

O FinançasPro possui tela de bloqueio e proteção em todas as rotas da API, funcionando tanto localmente quanto no Supabase e na Vercel:

### 1. Configuração Inicial via Interface (Recomendado)
1. Abra a aplicação no navegador (`http://localhost:3000` ou a URL do seu deploy na Vercel).
2. Como nenhuma senha foi configurada ainda, a tela exibirá automaticamente o formulário **"Criar Senha de Acesso"**.
3. Digite sua senha (mínimo de 4 caracteres), confirme-a no segundo campo e clique em **Salvar e Acessar**.
4. A senha será criptografada com `scrypt` e salva na tabela `app_settings` do seu Supabase, liberando o acesso imediatamente.

### 2. Configuração via Variável de Ambiente (Opcional)
Se preferir definir uma senha fixa diretamente pelo servidor (útil nas Environment Variables da Vercel):
```env
APP_PASSWORD=sua_senha_secreta
```
O sistema aceitará essa senha imediatamente para login.

### 3. Alterar Senha ou Bloquear
- **Alterar Senha:** Clique em **"🔑 Alterar Senha"** no rodapé da barra lateral.
- **Bloquear Tela:** Clique no ícone de cadeado **🔒** na barra superior ou em **"🔒 Bloquear / Sair"** na barra lateral.

---


## 🐳 Executando com Docker

Se preferir rodar em containers:

```bash
# Subir o container
docker compose up -d --build
```

O container injetará as variáveis do `.env` e servirá a aplicação na porta `3000`.

---

## 📁 Estrutura do Projeto

```
financaspro/
├── api/
│   └── index.js              # Entrypoint Serverless para a Vercel
├── public/
│   ├── css/
│   │   └── style.css         # Estilização completa e temas
│   ├── js/
│   │   ├── api.js            # Cliente HTTP para comunicação com o backend
│   │   ├── app.js            # Orquestração do app e estado
│   │   ├── charts.js         # Configurações do Chart.js
│   │   └── ui.js             # Renderização e manipulação do DOM
│   └── index.html            # Interface SPA principal
├── scripts/
│   └── migrate-to-supabase.js# Script de migração de dados
├── supabase/
│   └── migrations/           # Esquema relacional PostgreSQL
├── db.js                     # Camada de banco de dados (Pool PG + Supabase Client)
├── server.js                 # Servidor Express (API REST e regras de negócio)
├── vercel.json               # Configuração de rotas da Vercel
├── docker-compose.yml        # Orquestração Docker
├── Dockerfile                # Imagem de produção
├── package.json              # Dependências e scripts
└── README.md                 # Documentação
```

---

## 📄 Licença

Este projeto é de uso pessoal e privado. Todos os direitos reservados.
