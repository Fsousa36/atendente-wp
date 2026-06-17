import express from 'express';
import { GoogleGenAI } from '@google/genai';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const { Pool } = pg;

// 1. CONEXÃO COM O SEU POSTGRESQL (Puxa a URL configurada no seu arquivo .env)
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error("❌ Erro: A variável DATABASE_URL não foi encontrada no arquivo .env");
    process.exit(1);
}

const pool = new Pool({ 
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Permite a conexão segura com o banco remoto
    }
});

// 2. CONEXÃO COM A API DO GEMINI
const ai = new GoogleGenAI({}); // Puxa automaticamente a GEMINI_API_KEY do seu .env

// 3. AUTO-MIGRATE: Cria as tabelas do seu SaaS caso elas ainda não existam no banco
async function inicializarTabelas() {
    const queryTabelas = `
        CREATE TABLE IF NOT EXISTS empresas (
            id SERIAL PRIMARY KEY,
            nome_empresa VARCHAR(255) NOT NULL,
            prompt_personalidade TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS produtos (
            id SERIAL PRIMARY KEY,
            empresa_id INT REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(255) NOT NULL,
            preco DECIMAL(10,2) NOT NULL,
            descricao TEXT
        );

        CREATE TABLE IF NOT EXISTS historico_conversas (
            id SERIAL PRIMARY KEY,
            empresa_id INT REFERENCES empresas(id) ON DELETE CASCADE,
            cliente_whatsapp VARCHAR(50) NOT NULL,
            role VARCHAR(20) NOT NULL, -- 'user' ou 'model'
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pool.query(queryTabelas);
        console.log("⚡ Tabelas do PostgreSQL checadas e prontas para uso!");
    } catch (err) {
        console.error("❌ Erro ao inicializar tabelas no Postgres:", err);
    }
}
inicializarTabelas();

// 4. WEBHOOK PRINCIPAL: Rota que vai receber as mensagens do WhatsApp
app.post('/webhook/whatsapp', async (req, res) => {
    const { from, body, companyId } = req.body; // Número do cliente, o texto da mensagem e o ID da empresa

    if (!from || !body || !companyId) {
        return res.status(400).json({ error: "Dados incompletos no webhook. Envie 'from', 'body' e 'companyId'." });
    }

    try {
        // A. Grava a mensagem atual que o cliente enviou no histórico do Postgres
        await pool.query(
            'INSERT INTO historico_conversas (empresa_id, cliente_whatsapp, role, content) VALUES ($1, $2, $3, $4)',
            [companyId, from, 'user', body]
        );

        // B. Busca as configurações de personalidade da empresa
        const empresaRes = await pool.query('SELECT * FROM empresas WHERE id = $1', [companyId]);
        if (empresaRes.rows.length === 0) {
            return res.status(404).json({ error: "Empresa não cadastrada no sistema." });
        }
        const empresa = empresaRes.rows[0];

        // C. Busca a tabela de produtos/preços cadastrados para essa empresa
        const produtosRes = await pool.query('SELECT * FROM produtos WHERE empresa_id = $1', [companyId]);
        const tabelaProdutosTexto = produtosRes.rows.map(p => 
            `- ${p.nome}: R$ ${p.preco} (${p.descricao || 'Sem descrição'})`
        ).join('\n');

        // D. Busca a memória (as últimas 10 mensagens dessa conversa para o Gemini contextualizar)
        const historicoRes = await pool.query(
            'SELECT role, content FROM historico_conversas WHERE cliente_whatsapp = $1 AND empresa_id = $2 ORDER BY created_at DESC LIMIT 10',
            [from, companyId]
        );
        
        // Inverte o histórico para que fique na ordem cronológica correta (da mais antiga para a mais recente)
        const chatContents = historicoRes.rows.reverse().map(msg => ({
            role: msg.role, // 'user' ou 'model'
            parts: [{ text: msg.content }]
        }));

        // E. Estrutura a grande instrução mestre do atendente autônomo
        const systemInstruction = `${empresa.prompt_personalidade}\n\nTABELA DE PRODUTOS E PREÇOS ATUAIS DA EMPRESA:\n${tabelaProdutosTexto}\n\nREGRAS DE CONVENÇÃO:\n- Nunca invente produtos, serviços ou preços que não estão listados acima.\n- Responda de forma curta, objetiva e use quebras de linha frequentes para parecer digitação humana no WhatsApp.\n- Seu foco principal é tirar dúvidas e fechar o orçamento de forma natural.`;

        // F. Envia o histórico e as regras para o Gemini 1.5 Flash processar
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: chatContents,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.7, // Fator humano: varia as respostas sem perder o foco das regras
            }
        });

        const respostaIA = response.text;

        // G. Salva a resposta gerada pela IA no banco para servir de memória na próxima interação
        await pool.query(
            'INSERT INTO historico_conversas (empresa_id, cliente_whatsapp, role, content) VALUES ($1, $2, $3, $4)',
            [companyId, from, 'model', respostaIA]
        );

        // H. Resposta de sucesso do Webhook (Aqui no futuro você disparará para a API do seu Gateway de WhatsApp)
        return res.status(200).json({ success: true, reply: respostaIA });

    } catch (error) {
        console.error("❌ Erro interno ao processar mensagem do agente:", error);
        return res.status(500).json({ error: "Erro interno no servidor ao gerar atendimento." });
    }
});

// Inicializa o servidor na porta configurada
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor de Atendimento Ativo na porta ${PORT}`));