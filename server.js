import express from 'express';
import { GoogleGenAI } from '@google/genai';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const { Pool } = pg;

// Configuração robusta com injeção de SSL para aceitar a rede interna do Coolify
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Ignora a validação estrita de certificados autoassinados da VPS
    }
});

const ai = new GoogleGenAI({}); 

// Função que cria as tabelas automaticamente se elas não existirem
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

// ROTA EXCLUSIVA PARA POPULAR O BANCO DE DADOS DIRETO PELO NAVEGADOR
app.get('/adicionar-dados-teste', async (req, res) => {
    try {
        // Verifica se a empresa teste (ID 1) já existe para evitar duplicações
        const checarEmpresa = await pool.query("SELECT id FROM empresas WHERE id = 1");
        if (checarEmpresa.rows.length > 0) {
            return res.status(200).send("🚀 O banco já estava populado! Empresa ID 1 pronta para uso.");
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
            (1, 'Renovação Simplificada', 120.00, 'Para