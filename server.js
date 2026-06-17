import express from 'express';
import { GoogleGenAI } from '@google/genai';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const { Pool } = pg;

// Configuração robusta com SSL Bypass para aceitar a rede interna do Coolify
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const ai = new GoogleGenAI({}); 

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
            role VARCHAR(20) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pool.query(queryTabelas);
        console.log("⚡ Tabelas do PostgreSQL checadas e prontas para uso!");
    } catch (err) {
        console.error("❌ Erro ao criar tabelas no Postgres:", err);
    }
}
inicializarTabelas();

// ROTA EXCLUSIVA PARA POPULAR O BANCO DE DADOS PELO NAVEGADOR
app.get('/adicionar-dados-teste', async (req, res) => {
    try {
        // Verifica se a empresa já existe para não duplicar
        const checarEmpresa = await pool.query("SELECT id FROM empresas WHERE id = 1");
        if (checarEmpresa.rows.length > 0) {
            return res.status(200).send("🚀 O banco já estava populado! Empresa ID 1 pronta.");
        }

        // 1. Cria a primeira empresa (TecnoCert)
        await pool.query(`
            INSERT INTO empresas (id, nome_empresa, prompt_personalidade)
            VALUES (
                1,
                'TecnoCert Certificados Digitais',
                'Você é o Carlos, atendente virtual focado em vendas da TecnoCert. Seu objetivo é passar orçamentos de forma educada, humana e usar quebras de linha frequentes.'
            );
        `);

        // 2. Cadastra os produtos atrelados a ela
        await pool.query(`
            INSERT INTO produtos (empresa_id, nome, preco, descricao)
            VALUES 
            (1, 'Certificado Digital A1 em Nuvem', 149.90, 'Validade de 1 ano, ideal para computadores e celulares. Emissão 100% online por videoconferência.'),
            (1, 'Certificado Digital A3 Cartão/Token', 299.00, 'Validade de 3 anos. Mídia física inclusa.'),
            (1, 'Renovação Simplificada', 120.00, 'Para quem já é cliente e quer renovar o modelo A1 sem videoconferência.');
        `);

        return res.status(200).send("🚀 Banco populado com sucesso de dentro da VPS! Empresa ID: 1");
    } catch (error) {
        console.error(error);
        return res.status(500).send("❌ Erro ao popular banco: " + error.message);
    }
});

// Webhook do WhatsApp
app.post('/webhook/whatsapp', async (req, res) => {
    const { from, body, companyId } = req.body;

    if (!from || !body || !companyId) {
        return res.status(400).json({ error: "Dados incompletos no webhook." });
    }

    try {
        await pool.query(
            'INSERT INTO historico_conversas (empresa_id, cliente_whatsapp, role, content) VALUES ($1, $2, $3, $4)',
            [companyId, from, 'user', body]
        );

        const empresaRes = await pool.query('SELECT * FROM empresas WHERE id = $1', [companyId]);
        if (empresaRes.rows.length === 0) {
            return res.status(404).json({ error: "Empresa não cadastrada no sistema." });
        }
        const empresa = empresaRes.rows[0];

        const produtosRes = await pool.query('SELECT * FROM produtos WHERE empresa_id = $1', [companyId]);
        const tabelaProdutosTexto = produtosRes.rows.map(p => 
            `- ${p.nome}: R$ ${p.preco} (${p.descricao || ''})`
        ).join('\n');

        const historicoRes = await pool.query(
            'SELECT role, content FROM historico_conversas WHERE cliente_whatsapp = $1 AND empresa_id = $2 ORDER BY created_at DESC LIMIT 10',
            [from, companyId]
        );
        
        const chatContents = historicoRes.rows.reverse().map(msg => ({
            role: msg.role,
            parts: [{ text: msg.content }]
        }));

        const systemInstruction = `${empresa.prompt_personalidade}\n\nTABELA DE PRODUTOS E PREÇOS:\n${tabelaProdutosTexto}\n\nREGRAS:\n- Nunca invente preços ou produtos.\n- Use quebras de linha e seja muito natural.\n- Foque em fechar o orçamento de forma humana.`;

        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: chatContents,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.7,
            }
        });

        const respostaIA = response.text;

        await pool.query(
            'INSERT INTO historico_conversas (empresa_id, cliente_whatsapp, role, content) VALUES ($1, $2, $3, $4)',
            [companyId, from, 'model', respostaIA]
        );

        return res.status(200).json({ success: true, reply: respostaIA });

    } catch (error) {
        console.error("Erro interno no agente:", error);
        return res.status(500).json({ error: "Erro ao processar mensagem do agente." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor de Atendimento Ativo na porta ${PORT}`));