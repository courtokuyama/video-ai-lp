// POST /api/contact — receives the LP contact form and appends a row to a
// Notion database. Zero npm deps: calls the Notion REST API with global fetch.
//
// Required Vercel env var:
//   NOTION_TOKEN        Notion internal-integration secret (server-side only).
//                       The integration must be connected to the target DB.
// Optional env var:
//   NOTION_DATABASE_ID  target database id (defaults to the "LPお問い合わせ" DB).
//
// DB schema (property name -> type):
//   会社名 title / お名前 rich_text / メールアドレス email / 電話番号 phone_number
//   ご相談内容 rich_text / ステータス select(新規) / 受信日時 created_time (auto)

const NOTION_VERSION = '2022-06-28';
const DEFAULT_DB_ID = 'd299c5b7-2b79-4885-9f74-cac9fc0cfad7';
const MAX = { company: 200, name: 100, email: 200, phone: 40, message: 4000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Notion caps a single rich_text content at 2000 chars; chunk long text.
function richText(str) {
  const s = String(str || '');
  if (!s) return [];
  const out = [];
  for (let i = 0; i < s.length; i += 2000) {
    out.push({ text: { content: s.slice(i, i + 2000) } });
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // honeypot — bots fill hidden fields; pretend success and drop silently
  if (body.website || body._gotcha) return res.status(200).json({ ok: true });

  const company = (body.company || '').toString().trim();
  const name = (body.name || '').toString().trim();
  const email = (body.email || '').toString().trim();
  const phone = (body.phone || '').toString().trim();
  const message = (body.message || '').toString().trim();

  const errors = [];
  if (!company) errors.push('会社名は必須です');
  if (!name) errors.push('お名前は必須です');
  if (!email) errors.push('メールアドレスは必須です');
  else if (!EMAIL_RE.test(email)) errors.push('メールアドレスの形式が正しくありません');
  if (!phone) errors.push('電話番号は必須です');
  for (const k of Object.keys(MAX)) {
    if (body[k] && body[k].toString().length > MAX[k]) errors.push(`${k} が長すぎます`);
  }
  if (errors.length) return res.status(400).json({ ok: false, error: errors.join(' / ') });

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    console.error('NOTION_TOKEN is not set');
    return res.status(500).json({ ok: false, error: '送信設定が未完了です。時間をおいて再度お試しください。' });
  }
  const databaseId = process.env.NOTION_DATABASE_ID || DEFAULT_DB_ID;

  const properties = {
    '会社名': { title: richText(company) },
    'お名前': { rich_text: richText(name) },
    'メールアドレス': { email },
    '電話番号': { phone_number: phone },
    'ご相談内容': { rich_text: richText(message) },
    'ステータス': { select: { name: '新規' } },
  };

  try {
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('Notion error', r.status, detail);
      return res.status(502).json({ ok: false, error: '送信に失敗しました。お手数ですが contact@bewibe.com まで直接ご連絡ください。' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('contact handler error', e);
    return res.status(500).json({ ok: false, error: '送信中にエラーが発生しました。時間をおいて再度お試しください。' });
  }
};
