'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=Number(process.env.PORT||3000);
const HOST_KEY=process.env.HOST_KEY;
if(!HOST_KEY||HOST_KEY.length<20){console.error('HOST_KEY must be set to a secure 20+ character secret');process.exit(1)}
const allQuestions=JSON.parse(fs.readFileSync(path.join(__dirname,'questions.json'),'utf8'));
// Full edition: all nine questions in each of the four Word Challenge categories.
const questions=allQuestions;
function createGame(questions,capacity,testMode=false){
const state={pin:String(crypto.randomInt(100000,1000000)),phase:'lobby',index:0,started:0,endsAt:null,duration:30,players:{},responses:{},scores:{A:0,B:0},results:null};
const clients=new Set();
// Configured for large quiz events. This is a registration ceiling, not a guaranteed concurrent capacity.
const MAX_PLAYERS=capacity;
let pendingBroadcast=null;
function normal(s){return String(s??'').trim().replace(/\s+/g,' ').toLowerCase()}
function safePlayer(p){return {id:p.id,name:p.name,team:p.team}}
function snapshot(){const q=questions[state.index];return {pin:state.pin,phase:state.phase,index:state.index,total:questions.length,question:state.phase==='question'?{id:q.id,round:q.round,prompt:q.prompt,words:q.words,type:q.type,choices:q.choices}:state.phase==='results'?{id:q.id,round:q.round,prompt:q.prompt,words:q.words,type:q.type,completed:q.completed}:null,endsAt:state.endsAt,duration:state.duration,sectionRound:q.round,players:Object.values(state.players).map(safePlayer),capacity:MAX_PLAYERS,scores:state.scores,results:state.results,answered:Object.keys(state.responses).length}}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
function push(){if(pendingBroadcast!==null)return;pendingBroadcast=setTimeout(()=>{pendingBroadcast=null;const data='data: '+JSON.stringify(snapshot())+'\n\n';for(const client of clients){try{client.write(data)}catch{clients.delete(client)}}},120)}
function pushNow(){if(pendingBroadcast!==null){clearTimeout(pendingBroadcast);pendingBroadcast=null}const data='data: '+JSON.stringify(snapshot())+'\n\n';for(const client of clients){try{client.write(data)}catch{clients.delete(client)}}}
function finish(){if(state.phase!=='question')return;const q=questions[state.index],round={A:0,B:0};let fast=null;for(const [id,r] of Object.entries(state.responses)){const p=state.players[id];if(!p?.team)continue;if(normal(r.answer)===normal(q.answer)){round[p.team]++;if(!fast||r.at<fast.at)fast={name:p.name,team:p.team,seconds:Math.max(0,Math.round((r.at-state.started)/100)/10),at:r.at}}}state.scores.A+=round.A;state.scores.B+=round.B;state.results={round,fast,roundWinner:round.A===round.B?'draw':round.A>round.B?'A':'B',correct:q.answer,completed:q.completed||[]};state.phase='results';state.endsAt=null;pushNow()}
function action(req,res,data){let b;try{b=JSON.parse(data||'{}')}catch{return send(res,400,{error:'Invalid JSON'})}
if(b.op==='join'){
 const name=String(b.name||'').trim().slice(0,50),phone=String(b.phone||'').replace(/\D/g,'');
 if(testMode){
  if(String(b.pin)!==state.pin||!name)return send(res,400,{error:'Enter your assigned player name and game PIN'});
  if(!['lobby','section','question'].includes(state.phase))return send(res,409,{error:'This test has ended'});
  const player=Object.values(state.players).find(p=>normal(p.name)===normal(name)&&p.manual);
  if(!player)return send(res,404,{error:'Ask the host to add your name before joining'});
  if(player.claimed)return send(res,409,{error:'This player is already connected on another device'});
  player.claimed=true;player.token=crypto.randomBytes(24).toString('hex');player.phone=phone||'test-device';
  pushNow();return send(res,200,{id:player.id,token:player.token});
 }
 if(!name||phone.length<7||phone.length>15||String(b.pin)!==state.pin)return send(res,400,{error:'Enter name, valid phone and game PIN'});
 if(state.phase!=='lobby')return send(res,409,{error:'Registration closed'});
 if(Object.values(state.players).some(p=>p.phone===phone))return send(res,409,{error:'Mobile number already registered'});
 if(Object.keys(state.players).length>=MAX_PLAYERS)return send(res,409,{error:'Registration is full ('+MAX_PLAYERS+' players)'});
 const id=crypto.randomUUID(),token=crypto.randomBytes(24).toString('hex');
 state.players[id]={id,token,name,phone,team:null};push();return send(res,200,{id,token});
}
if(b.op==='answer'){const p=state.players[b.id];if(!p||p.token!==b.token||!p.team)return send(res,403,{error:'Invalid participant registration'});if(state.phase!=='question'||Date.now()>=state.endsAt)return send(res,409,{error:'Question closed'});if(state.responses[b.id])return send(res,409,{error:'Already answered'});const q=questions[state.index],answer=String(b.answer||'');if(q.type==='choice'&&!q.choices?.includes(answer))return send(res,400,{error:'Select an answer'});if(q.type!=='choice'&&!/^[a-zA-Z ]{1,75}$/.test(answer))return send(res,400,{error:'Letters and spaces only, max 75 characters'});state.responses[b.id]={answer,at:Date.now()};push();return send(res,200,{ok:true})}
if(b.hostKey!==HOST_KEY)return send(res,403,{error:'Incorrect host key'});
if(testMode&&b.op==='addTestPlayer'){
 if(state.phase!=='lobby')return send(res,409,{error:'Reset the test before adding players'});
 const name=String(b.name||'').trim().slice(0,50),team=String(b.team||'').toUpperCase();
 if(!name||!['A','B'].includes(team))return send(res,400,{error:'Enter a name and select Team A or B'});
 if(Object.values(state.players).some(p=>p.team===team))return send(res,409,{error:'Team '+team+' already has a player'});
 if(Object.values(state.players).some(p=>normal(p.name)===normal(name)))return send(res,409,{error:'Use two different player names'});
 const id=crypto.randomUUID();
 state.players[id]={id,token:'',name,phone:'',team,manual:true,claimed:false};
 pushNow();return send(res,200,{ok:true});
}

if(testMode&&b.op==='demoPlayers'){
 if(state.phase!=='lobby')return send(res,409,{error:'Reset the test before creating sample players'});
 // No registration required on other devices. Only modifies the isolated test session.
 state.players={};state.responses={};state.scores={A:0,B:0};state.results=null;
 for(const [name,team] of [['Test Player A','A'],['Test Player B','B']]){
  const id=crypto.randomUUID();
  state.players[id]={id,token:crypto.randomBytes(24).toString('hex'),name,phone:'demo-'+team,team,demo:true};
 }
 pushNow();return send(res,200,{ok:true});
}
if(testMode&&b.op==='demoAnswer'){
 if(state.phase!=='question')return send(res,409,{error:'Show the question before submitting a test answer'});
 if(Date.now()>=state.endsAt)return send(res,409,{error:'Question timer ended'});
 const team=String(b.team||'').toUpperCase();
 if(!['A','B'].includes(team))return send(res,400,{error:'Choose Team A or B'});
 const player=Object.values(state.players).find(p=>p.team===team&&p.demo);
 if(!player)return send(res,409,{error:'Create the two sample players first'});
 if(state.responses[player.id])return send(res,409,{error:'This test player has already answered'});
 state.responses[player.id]={answer:String(b.correct===false?'WRONG':questions[state.index].answer),at:Date.now()};
 pushNow();return send(res,200,{ok:true});
}
if(b.op==='team'){if(state.phase!=='lobby')return send(res,409,{error:'Assign teams before the game'});if(!state.players[b.id]||!['A','B'].includes(b.team))return send(res,400,{error:'Invalid team'});state.players[b.id].team=b.team}
else if(b.op==='duration'){if(!['lobby','section','results'].includes(state.phase))return send(res,409,{error:'Change timer before starting a question'});const v=Number(b.seconds);if(!Number.isInteger(v)||v<5||v>300)return send(res,400,{error:'Choose 5–300 seconds'});state.duration=v}
else if(b.op==='start'||b.op==='next'){if((b.op==='start'&&state.phase!=='lobby')||(b.op==='next'&&!['results','section'].includes(state.phase)))return send(res,409,{error:'Not ready'});if(b.op==='start'&&(!Object.keys(state.players).length||Object.values(state.players).some(p=>!p.team)||(testMode&&(Object.keys(state.players).length!==2||!Object.values(state.players).every(p=>p.claimed)))))return send(res,409,{error:'Add both test players on the Host and have each join on their device before starting'});if(b.op==='start'){state.phase='section';state.endsAt=null;state.responses={};state.results=null}else{if(state.phase==='results')state.index++;if(state.index>=questions.length){state.phase='finished';state.index=questions.length-1;state.results=null}else if(state.index>0&&questions[state.index].round!==questions[state.index-1].round&&state.phase==='results'){state.phase='section';state.results=null;state.endsAt=null}else{state.phase='question';state.responses={};state.results=null;state.started=Date.now();state.endsAt=state.started+state.duration*1000}}}
else if(b.op==='reveal'){finish();return send(res,200,{ok:true})}
else if(b.op==='reset'){state.phase='lobby';state.index=0;state.endsAt=null;state.responses={};state.scores={A:0,B:0};state.results=null;state.pin=String(crypto.randomInt(100000,1000000));state.players={}}
else return send(res,400,{error:'Unknown action'});pushNow();return send(res,200,{ok:true})}

return {state,questions,clients,snapshot,action,finish};
}
const mainGame=createGame(allQuestions,Math.max(100,Math.min(500,Number(process.env.MAX_PLAYERS)||200)),false);
const testGame=createGame([allQuestions.find(q=>q.id===30&&q.round===4)],2,true);
if(!testGame.questions[0])throw Error('Test question 30 missing');
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
const allowed=new Set(['index.html','app.js','style.css','word-challenge-1.svg','correct-answer.b64','suspense-audio.mp3','final-victory.b64']);
http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const directTestRoutes={'/test-host':'host','/test-player':'player','/test-screen':'screen'};
 if(directTestRoutes[pathname]){res.writeHead(302,{'Location':'/?view='+directTestRoutes[pathname]+'&test=1','Cache-Control':'no-store'});return res.end()}
 const test=pathname.startsWith('/test/');
 const game=test?testGame:mainGame;
 const resource=test?pathname.slice(5):pathname;
 if(req.method==='GET'&&resource==='/health')return send(res,200,{ok:true});
 if(req.method==='GET'&&resource==='/events'){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write('data: '+JSON.stringify(game.snapshot())+'\n\n');
  game.clients.add(res);req.on('close',()=>game.clients.delete(res));return;
 }
 if(req.method==='GET'&&resource==='/state')return send(res,200,game.snapshot());
 if(req.method==='POST'&&resource==='/api'){
  let body='';req.on('data',chunk=>{body+=chunk;if(body.length>12000)req.destroy()});
  req.on('end',()=>game.action(req,res,body));return;
 }
 let filename=pathname==='/'?'index.html':pathname.slice(1);
 if(req.method!=='GET'||!allowed.has(filename))return send(res,404,{error:'Not found'});
 res.writeHead(200,{'Content-Type':filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.svg')?'image/svg+xml':filename.endsWith('.b64')?'text/plain':filename.endsWith('.mp3')?'audio/mpeg':'text/html','Cache-Control':'no-cache'});
 fs.createReadStream(path.join(__dirname,filename)).pipe(res);
}).listen(PORT,'0.0.0.0',()=>console.log('Word Challenge server on '+PORT));
setInterval(()=>{for(const game of [mainGame,testGame])if(game.state.phase==='question'&&Date.now()>=game.state.endsAt)game.finish()},250);
setInterval(()=>{for(const game of [mainGame,testGame])for(const client of game.clients)try{client.write(': ping\n\n')}catch{game.clients.delete(client)}},15000);
