import pg from 'pg';
const { Pool } = pg;

// URL de conexão externa ou o IP público para acessar o banco do seu PC:
const DATABASE_URL = "postgresql://atendentesaas:@Fsousa518581@atendentesaas-2ndvuc:5432/atendentewp"; 
// 💡 NOTA: Lembre-se de trocar "atendentesaas-2ndvuc" pelo IP Público da sua VPS se for rodar do seu PC Windows!

const pool = new Pool({ connectionString: DATABASE_URL });

async function cadastrarDados() {
  try {
    console.log("⏳ Conectando para inserir dados de teste...");

    // 1. Criar Empresa (Gera o ID 1)
    const empresa = await pool.query(`
      INSERT INTO empresas (nome_empresa, prompt_personalidade)
      VALUES (
        'TecnoCert Certificados Digitais',
        'Você é o Carlos, atendente virtual da TecnoCert. Seja educado, use quebras de linha e envie os preços da nossa tabela quando o cliente perguntar.'
      ) RETURNING id;
    `);
    const empresaId = empresa.rows[0].id;

    // 2. Criar Produtos vinculados à empresa 1
    await pool.query(`
      INSERT INTO produtos (empresa_id, nome, preco, descricao)
      VALUES 
      ($1, 'Certificado Digital A1 em Nuvem', 149.90, 'Validade de 1 ano. Emissão 100% online por videoconferência.'),
      ($1, 'Certificado Digital A3 Token', 299.00, 'Validade de 3 anos. Mídia física inclusa.');
    `, [empresaId]);

    console.log("🚀 Empresa 1 e produtos cadastrados com sucesso!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  }
}
cadastrarDados();