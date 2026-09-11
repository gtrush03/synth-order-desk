import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fleetSnapshot } from './fleet-monitor.ts';
import { TASKS, SEED_DATE } from './model.ts';
import { StateStore, StateError } from './state.ts';
import { liveSources, probeTargets, readDocument } from './sources.ts';
import { createConversation, getConversation, conversationTurn, transcribeVoice, readArtifact, getCompany, readDataReceipt, readBrowserShot, sendApprovedDemoEmail, saveApprovedPrintfulDraft } from './local-conversation.ts';
import { progressSnapshot } from './live-progress.ts';
import { workspaceMap } from './workspace-map.ts';
import {naturalVoice} from './natural-voice.ts';
import {GptLiveServer,gptLiveAllowance,GptLiveError} from './gpt-live.ts';

export const DEFAULT_OUTPUT = process.env.TRU_PLAN_OUTPUT ?? resolve(process.cwd(), 'run');
const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

async function body(request: IncomingMessage, limit=25_000): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new StateError(415, 'Use JSON for checklist updates.');
  const pieces: Buffer[] = [];
  let size = 0;
  for await (const piece of request) {
    size += piece.length;
    if (size > limit) throw new StateError(413, 'Update is too large.');
    pieces.push(piece);
  }
  try { return JSON.parse(Buffer.concat(pieces).toString()); }
  catch { throw new StateError(400, 'Update is not valid JSON.'); }
}

export function makeServer(options: { storePath: string; publicPath: string; monitor?: boolean }) {
  const store = new StateStore(options.storePath);
  const voiceData=resolve(DEFAULT_OUTPUT,'conversation');let voiceReady:Promise<GptLiveServer>|undefined;
  const voice=()=>voiceReady??=(async()=>{const token=process.env['CF_AIG_TOKEN'];const v=new GptLiveServer({dataDir:voiceData,token:()=>token,conversationTurn:async input=>{if(input.signal.aborted)throw new StateError(409,'Voice request was cancelled.');const current=await getConversation(input.conversationId);const result=await conversationTurn({id:current.id,revision:current.revision,message:input.message});return {reply:result.reply};}});await v.recover();return v;})();
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const send = (code: number, value: unknown) => { response.writeHead(code, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    try {
      const host = request.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw new StateError(403, 'This dashboard is available only on localhost.');
      const url = new URL(request.url ?? '/', `http://${host}`);
      const method = request.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        const origin = request.headers.origin;
        if (origin !== `http://${host}`) throw new StateError(403, 'Checklist updates must come from this localhost page.');
      }
      if (method === 'GET' && url.pathname === '/api/snapshot') {
        const state = await store.read();
        const sources = await liveSources();
        send(200, { ...sources, revision: state.revision, tasks: TASKS.map(task => ({ ...task, ...state.edits[task.id], manual: Boolean(state.edits[task.id]) })), history: state.history, seedDate: SEED_DATE, generatedAt: new Date().toISOString() });
        return;
      }
      if(method==='GET'&&url.pathname==='/api/gpt-live/status'){let enabled=false;try{enabled=Boolean(await gptLiveAllowance(voiceData));}catch{}send(200,{enabled,model:'gpt-live-1',voice:'willow'});return;}
      if(method==='POST'&&url.pathname.startsWith('/api/gpt-live/')){const payload=await body(request,100_000) as any;const v=await voice();switch(url.pathname){case '/api/gpt-live/session':await getConversation(payload.conversationId);send(200,await v.create(payload));return;case '/api/gpt-live/delegate':send(200,await v.delegate(payload));return;case '/api/gpt-live/event':await v.observe(payload);send(200,{});return;case '/api/gpt-live/close':await v.close(payload.attemptId);send(200,{});return;default:throw new StateError(404,'Voice action not found.');}}
      if(method==='GET'&&url.pathname==='/api/fleet'){send(200,await fleetSnapshot());return;}
      if(method==='POST'&&url.pathname==='/api/conversation/new'){await body(request);send(200,await createConversation());return;}
      if(method==='GET'&&url.pathname==='/api/conversation'){send(200,await getConversation(url.searchParams.get('id')));return;}
      if(method==='GET'&&url.pathname==='/api/company'){send(200,await getCompany());return;}
      if(method==='GET'&&url.pathname==='/api/workspace-map'){send(200,workspaceMap(await getCompany()));return;}
      if(method==='GET'&&url.pathname==='/api/conversation/progress'){const progress=progressSnapshot(url.searchParams.get('id'));if(!progress)throw new StateError(400,'Start a valid conversation first.');send(200,progress);return;}
      if(method==='POST'&&url.pathname==='/api/conversation/turn'){send(200,await conversationTurn(await body(request)));return;}
      if(method==='POST'&&url.pathname==='/api/voice/speak'){const p=await body(request) as any;const audio=await naturalVoice(DEFAULT_OUTPUT,p.text);response.writeHead(200,{...securityHeaders,'Content-Type':'audio/mpeg'});response.end(audio);return;}
      if(method==='POST'&&url.pathname==='/api/handoff/printful'){send(200,await saveApprovedPrintfulDraft(await body(request)));return;}
      if(method==='POST'&&url.pathname==='/api/handoff/email'){send(200,await sendApprovedDemoEmail(await body(request)));return;}
      if(method==='POST'&&url.pathname==='/api/voice/transcribe'){send(200,await transcribeVoice(request));return;}
      const artifactMatch=url.pathname.match(/^\/api\/conversation\/artifact\/([a-f0-9-]+)$/);
      if(method==='GET'&&artifactMatch){const content=await readArtifact(artifactMatch[1]);response.writeHead(200,{...securityHeaders,'Content-Type':'text/plain; charset=utf-8'});response.end(content);return;}
      const dataMatch=url.pathname.match(/^\/api\/conversation\/receipt\/([a-f0-9-]+)$/);
      const shotMatch=url.pathname.match(/^\/api\/conversation\/browser-shot\/([a-f0-9-]+)$/);
      if(method==='GET'&&shotMatch){const content=await readBrowserShot(shotMatch[1]);response.writeHead(200,{...securityHeaders,'Content-Type':'image/png'});response.end(content);return;}
      if(method==='GET'&&dataMatch){const content=await readDataReceipt(dataMatch[1]);response.writeHead(200,{...securityHeaders,'Content-Type':'application/json; charset=utf-8'});response.end(content);return;}
      const taskMatch = url.pathname.match(/^\/api\/tasks\/([a-z0-9-]+)$/);
      if (method === 'PATCH' && taskMatch) {
        const payload = await body(request) as { revision: number; edit: unknown };
        if (!payload || typeof payload !== 'object') throw new StateError(400, 'Provide a task update.');
        const state = await store.update(taskMatch[1], payload.revision, payload.edit);
        send(200, { revision: state.revision, savedAt: state.edits[taskMatch[1]].updatedAt });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/export') {
        const state = await store.read();
        response.writeHead(200, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="tru-synth-checklist.json"' });
        response.end(JSON.stringify({ ...state, exportedAt: new Date().toISOString(), tasks: TASKS.map(task => ({ ...task, ...state.edits[task.id] })) }, null, 2));
        return;
      }
      const docMatch = url.pathname.match(/^\/evidence\/([a-z0-9-]+)$/);
      if (method === 'GET' && docMatch) {
        const document = await readDocument(docMatch[1]);
        if (document === null) throw new StateError(404, 'Evidence document not found.');
        response.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(document);
        return;
      }
      if (method !== 'GET' && method !== 'HEAD') throw new StateError(405, 'Method not supported.');
      const files: Record<string, [string, string]> = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/wordmark.png': ['wordmark.png', 'image/png'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      files['/briefing'] = ['briefing.html', 'text/html; charset=utf-8'];
      files['/briefing/'] = files['/briefing'];
      files['/briefing.js'] = ['briefing.js', 'text/javascript; charset=utf-8'];
      files['/briefing.css'] = ['briefing.css', 'text/css; charset=utf-8'];
      files['/demo'] = ['stage.html', 'text/html; charset=utf-8'];
      files['/stage.html'] = files['/demo'];
      files['/stage.js'] = ['stage.js', 'text/javascript; charset=utf-8'];
      files['/stage.css'] = ['stage.css', 'text/css; charset=utf-8'];
      files['/today'] = ['today.html','text/html; charset=utf-8'];
      files['/today.js'] = ['today.js','text/javascript; charset=utf-8'];
      files['/today.css'] = ['today.css','text/css; charset=utf-8'];
      files['/talk'] = ['talk.html', 'text/html; charset=utf-8'];
      files['/talk.js'] = ['talk.js', 'text/javascript; charset=utf-8'];
      files['/talk.css'] = ['talk.css', 'text/css; charset=utf-8'];
      for(const name of ['hotdata.svg','hydradb.png','cognee.svg','rote.png','rocketride.svg','snyk.svg'])files[`/sponsors/${name}`]=[`sponsors/${name}`,name.endsWith('.svg')?'image/svg+xml':'image/png'];
      if (url.pathname === '/demo/') { response.writeHead(302, { ...securityHeaders, Location: '/demo' }); response.end(); return; }
      if (!Object.hasOwn(files, url.pathname)) throw new StateError(404, 'Page not found.');
      const [file, contentType] = files[url.pathname];
      const content = await readFile(resolve(options.publicPath, file));
      const headers = { ...securityHeaders, 'Content-Type': contentType };
      if (file === 'stage.html') headers['Content-Security-Policy'] = securityHeaders['Content-Security-Policy'].replace("connect-src 'self'", "connect-src 'none'").replace("form-action 'self'", "form-action 'none'");
      if (file === 'talk.html') headers['Content-Security-Policy'] += "; media-src 'self' blob:; object-src 'none'";
      response.writeHead(200, headers);
      response.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      send(error instanceof StateError || error instanceof GptLiveError ? error.status : 503, { error: error instanceof StateError || error instanceof GptLiveError ? error.message : 'A local source is unavailable. Your saved checklist has not been reset.' });
    }
  });
  let timer: NodeJS.Timeout | undefined;
  if (options.monitor !== false) {
    void probeTargets(true);
    timer = setInterval(() => { void probeTargets(); }, 60_000);
    timer.unref();
  }
  server.on('close', () => { if (timer) clearInterval(timer); });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
