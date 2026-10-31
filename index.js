import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const upload = multer({ dest: path.join(os.tmpdir(), 'minicut-uploads'), limits: { fileSize: 250 * 1024 * 1024 } });
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.slice(-2500) || `FFmpeg exited ${code}`)));
  });
}
async function safeUnlink(file) { if (file) await fs.unlink(file).catch(() => {}); }
function assTime(seconds) {
  const cs = Math.max(0, Math.round(Number(seconds || 0) * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`;
}
function assEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\r?\n/g, '\\N');
}
function assColor(hex, alpha = 0) {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'FFFFFF';
  const r = h.slice(0,2), g = h.slice(2,4), b = h.slice(4,6);
  return `&H${alpha.toString(16).padStart(2,'0').toUpperCase()}${b}${g}${r}&`;
}
function buildAss(subtitles, style) {
  const font = String(style.fontFamily || 'Noto Sans Thai').replace(/[,\r\n]/g, '').slice(0,40);
  const size = Math.min(80, Math.max(14, Number(style.fontSize) || 34));
  const outline = Math.min(8, Math.max(0, Number(style.outline) || 0));
  const opacity = Math.min(90, Math.max(0, Number(style.bgOpacity) || 0));
  const backAlpha = Math.round(255 * (1 - opacity / 100));
  const alignment = style.position === 'top' ? 8 : style.position === 'middle' ? 5 : 2;
  const marginV = style.position === 'middle' ? 0 : 42;
  const primary = assColor(style.color || '#FFFFFF');
  const back = assColor('#000000', backAlpha);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${font},${size},${primary},&H000000FF,&H00000000,${back},-1,0,0,0,100,100,0,0,${opacity ? 3 : 1},${outline},0,${alignment},90,90,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = subtitles.map(s => {
    const thai = assEscape(s.thai);
    const english = assEscape(s.english);
    const text = [thai, english].filter(Boolean).join('\\N');
    return `Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Default,,0,0,0,,${text}`;
  }).join('\n');
  return header + events + '\n';
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'MiniCut Studio' }));

app.post('/api/transcribe', upload.single('video'), async (req, res) => {
  const input = req.file?.path;
  let audioPath;
  try {
    if (!input) return res.status(400).json({ error: 'ไม่พบไฟล์วิดีโอ' });
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes('ใส่_')) {
      return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่า OPENAI_API_KEY ในไฟล์ .env' });
    }
    audioPath = `${input}.mp3`;
    await runFfmpeg(['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath]);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const transcription = await client.audio.transcriptions.create({
      file: await fs.open(audioPath).then(async h => { const b = await h.readFile(); await h.close(); return new File([b], 'audio.mp3', { type: 'audio/mpeg' }); }),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment']
    });
    const segments = (transcription.segments || []).filter(s => String(s.text || '').trim());
    if (!segments.length && transcription.text) {
      segments.push({ start: 0, end: 3, text: transcription.text });
    }
    const translated = [];
    for (let i = 0; i < segments.length; i += 35) {
      const batch = segments.slice(i, i + 35);
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'For every input subtitle, produce BOTH a natural Thai translation/transcription and a natural English translation. If the source is already Thai, preserve it naturally in thai and translate to English. If the source is English, preserve it naturally in english and translate to Thai. For any other language, translate into both. Keep subtitle wording concise and preserve the original order. Return JSON exactly as {"thai":["..."],"english":["..."]}. Do not add commentary.' },
          { role: 'user', content: JSON.stringify(batch.map(s => s.text)) }
        ]
      });
      let parsed;
      try { parsed = JSON.parse(response.choices[0].message.content || '{}'); } catch { parsed = {}; }
      translated.push(...batch.map((segment, j) => ({
        thai: String(parsed.thai?.[j] || segment.text || '').trim(),
        english: String(parsed.english?.[j] || '').trim()
      })));
    }
    const subtitles = segments.map((s, i) => ({
      start: Number(s.start || 0), end: Math.max(Number(s.end || 0), Number(s.start || 0) + 0.5),
      thai: String(translated[i]?.thai || s.text || '').trim(), english: String(translated[i]?.english || '').trim()
    }));
    res.json({ subtitles, language: transcription.language || 'unknown' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `ประมวลผลไม่สำเร็จ: ${err.message}` });
  } finally { await safeUnlink(input); await safeUnlink(audioPath); }
});

app.post('/api/export', upload.single('video'), async (req, res) => {
  const input = req.file?.path;
  let assPath, outputPath;
  try {
    if (!input) return res.status(400).json({ error: 'ไม่พบไฟล์วิดีโอ' });
    const subtitles = JSON.parse(req.body.subtitles || '[]');
    const style = JSON.parse(req.body.style || '{}');
    if (!Array.isArray(subtitles) || !subtitles.length) return res.status(400).json({ error: 'ไม่มีซับไตเติ้ลสำหรับส่งออก' });
    assPath = `${input}.ass`; outputPath = `${input}-minicut.mp4`;
    await fs.writeFile(assPath, buildAss(subtitles, style), 'utf8');
    const filterPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    const resolution = req.body.resolution;
    const scale = resolution === '1080' ? 'scale=-2:1080' : resolution === '720' ? 'scale=-2:720' : null;
    const filters = [scale, `subtitles='${filterPath}'`].filter(Boolean).join(',');
    await runFfmpeg(['-y', '-i', input, '-vf', filters, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath]);
    res.download(outputPath, 'minicut-video.mp4', async () => {
      await safeUnlink(input); await safeUnlink(assPath); await safeUnlink(outputPath);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `ส่งออกไม่สำเร็จ: ${err.message}` });
  } finally {
    // Output is removed after the response finishes; failed temporary inputs are cleaned here.
    if (!outputPath) await safeUnlink(input);
    await safeUnlink(assPath);
  }
});

app.use(express.static(path.resolve(__dirname, '../dist')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.resolve(__dirname, '../dist/index.html'));
});
app.listen(PORT, () => console.log(`MiniCut Studio server running at http://localhost:${PORT}`));
