# Rodar o Lattice em outro computador

## 1. Instale

- Git
- Node.js 22.13 ou superior

## 2. Baixe o projeto

```powershell
git clone https://github.com/giovannefeitosa/lattice-human-friendly-graph-database.git
cd lattice-human-friendly-graph-database
npm install
```

## 3. Crie uma chave do R2

1. Abra o painel da Cloudflare.
2. Entre em **R2 Object Storage → Manage R2 API Tokens**.
3. Crie um token com **Object Read & Write** somente para o bucket `lattice`.
4. Copie o **Access Key ID** e o **Secret Access Key**.

## 4. Crie o arquivo `.dev.vars`

Na raiz do projeto, crie `.dev.vars`:

```dotenv
LATTICE_LOCAL_USER_EMAIL="giovanneafonso@gmail.com"
LATTICE_R2_ACCOUNT_ID="cded515a5dfa70d507572c17aa77b642"
LATTICE_R2_BUCKET="lattice"
LATTICE_R2_ACCESS_KEY_ID="COLE_O_ACCESS_KEY_ID"
LATTICE_R2_SECRET_ACCESS_KEY="COLE_O_SECRET_ACCESS_KEY"
```

## 5. Prepare e abra

```powershell
npm run db:local:setup
npm run dev
```

Confirme a migração se solicitado. Abra no navegador o endereço exibido no terminal.
