# WA Leads Dashboard

Um dashboard em Electron para gerenciar e analisar leads do WhatsApp Business com interface em português brasileiro, tema escuro/vermelho, banco de dados SQLite e gráficos interativos.

## 📋 Descrição

O WA Leads Dashboard é uma aplicação desktop desenvolvida em Electron que permite:

- **Gerenciar múltiplas contas do WhatsApp Business** simultaneamente
- **Capturar e classificar leads automaticamente** baseado em padrões configuráveis
- **Visualizar estatísticas em tempo real** com gráficos interativos
- **Exportar dados** para CSV
- **Sistema de reativação inteligente** para evitar duplicação de leads

## 🚀 Instalação

### Pré-requisitos
- Node.js (versão 16 ou superior)
- npm ou yarn

### Passos de Instalação

1. **Clone o repositório**
   ```bash
   git clone <url-do-repositorio>
   cd wa-leads-dashboard-hotfix11
   ```

2. **Instale as dependências**
   ```bash
   npm install
   ```

3. **Execute a aplicação**
   ```bash
   npm start
   ```

## 📖 Como Usar

### 1. Adicionar Contas do WhatsApp
- Digite um nome para a conta (ex: "Vendas 01")
- Clique em "Adicionar Conta"
- Uma nova janela do WhatsApp Web será aberta
- Faça login com sua conta do WhatsApp Business

### 2. Configurar Padrões de Classificação
- Acesse a seção "Padrões" no dashboard
- Adicione novos padrões com:
  - **ID**: Identificador único
  - **Nome**: Nome descritivo
  - **Tipo**: equals, contains, startsWith, ou regex
  - **Valor**: Texto ou expressão a ser procurada
- Clique em "Salvar padrões"

### 3. Configurar Sistema de Reativação
- Na seção "Configurações", ajuste os "Dias para reativação"
- Padrão: 14 dias (após este período, um contato é considerado novo lead)
- Clique em "Salvar"

### 4. Visualizar Dados
- **Leads de Hoje**: Contador de leads do dia atual
- **Por Conta**: Distribuição de leads por conta
- **Por Padrão**: Classificação de leads por padrão
- **Gráfico Diário**: Visualização temporal dos leads
- **Tabela de Leads**: Lista detalhada dos leads recentes

### 5. Exportar Dados
- Menu "Arquivo" → "Exportar CSV..."
- Escolha o local e nome do arquivo
- Os dados serão exportados com todas as informações dos leads

## 🛠️ Scripts Disponíveis

```bash
# Executar em modo desenvolvimento
npm run dev

# Executar aplicação
npm start

```

## 🏗️ Arquitetura

### Estrutura do Projeto
```
src/
├── main.js          # Processo principal do Electron
├── renderer.js      # Interface do usuário
├── preload.js       # Script de pré-carregamento
├── index.html       # Template HTML principal
└── style.css        # Estilos CSS com tema escuro
```

### Recursos de Debug
- Tabela de eventos para monitoramento
- Logs no console do Electron
- Indicador de último evento recebido

---

**Versão**: 2.0.1  
**Última atualização**: Hotfix 11