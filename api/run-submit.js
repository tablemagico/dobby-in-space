module.exports.config = { runtime: 'nodejs' };
const Redis = require('ioredis');

let client;
function getRedis(){
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  const opts = {};
  try { const u = new URL(url); if (u.protocol === 'rediss:') opts.tls = {}; } catch(_) {}
  client = new Redis(url, opts);
  return client;
}

const NS = process.env.LAMU_RUN_NS || 'sentient:run';
const BOARD_KEY  = `${NS}:board`;
const DETAIL_KEY = (h) => `${NS}:detail:${h}`;

// yüksek skor önde; eşitse süre küçük olan öne
const composite = (score, timeMs) => (Math.floor(score) * 1_000_000_000) - Math.floor(timeMs);

function readJson(req){
  return new Promise((resolve, reject)=>{
    let data=''; req.on('data', c => data += c);
    req.on('end', ()=> { try{ resolve(data ? JSON.parse(data) : {}); } catch(e){ reject(e); } });
    req.on('error', reject);
  });
}
function normHandle(h){
  return String(h||'').toLowerCase().replace(/^@/,'').replace(/[^a-z0-9_.-]/g,'').trim().slice(0,32) || 'guest';
}

module.exports = async (req, res) => {
  if (req.method !== 'POST'){ res.statusCode = 405; res.end('Method Not Allowed'); return; }
  try{
    const body = await readJson(req);
    let { handle, score, timeMs, ammoLeft } = body;

    handle   = normHandle(handle);
    score    = Number.isFinite(Number(score))    ? Math.max(0, Math.floor(Number(score)))    : NaN;
    timeMs   = Number.isFinite(Number(timeMs))   ? Math.max(0, Math.floor(Number(timeMs)))   : NaN;
    ammoLeft = Number.isFinite(Number(ammoLeft)) ? Math.max(0, Math.floor(Number(ammoLeft))) : 0;

    if (!handle || Number.isNaN(score) || Number.isNaN(timeMs)){
      res.statusCode = 400; res.setHeader('content-type','application/json');
      res.end(JSON.stringify({ error: 'Invalid payload' })); return;
    }

    const r = getRedis();
    const cur = await r.zscore(BOARD_KEY, handle);
    const curNum = cur == null ? null : Number(cur);
    const nextScore = composite(score, timeMs);

    let updated = false;
    if (curNum == null || nextScore > curNum) {
      const multi = r.multi();
      multi.zadd(BOARD_KEY, nextScore, handle);
      multi.hset(DETAIL_KEY(handle),
        'score', String(score),
        'timeMs', String(timeMs),
        'ammoLeft', String(ammoLeft),
        'updatedAt', String(Date.now())
      );
      await multi.exec();
      updated = true;
    }

    res.statusCode = 200; res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ updated }));
  } catch (e) {
    res.statusCode = 500; res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ error: String(e) }));
  }
};
