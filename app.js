const testMode=new URLSearchParams(location.search).get('test')==='1';
const sessionSuffix=testMode?'_test':'';
const endpointPrefix=testMode?'/test':'';
let view=new URLSearchParams(location.search).get('view')||'host';
let state=null,playerId=localStorage.getItem('qm_player'+sessionSuffix)||'',playerToken=localStorage.getItem('qm_token'+sessionSuffix)||'',hostKey=sessionStorage.getItem('qm_host')||'',selected='',submittedFor=-1,lastResult=-1;
const el=document.getElementById('app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setView(v){if(v==='player'){stopAllQuizAudio()}view=v;history.replaceState(null,'','?view='+v+(testMode?'&test=1':''));document.body.classList.toggle('screen-mode',v==='screen');document.body.classList.toggle('player-mode',v==='player');render()}
async function launchSlideshow(){
 // Fullscreen requires a direct tap/click in supported browsers.
 try{
  unlockAudio();
  if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen({navigationUI:'hide'});}
  else if(document.documentElement.webkitRequestFullscreen){document.documentElement.webkitRequestFullscreen();}
  else{document.getElementById('slideshow-help')?.classList.remove('hidden');return}
  document.body.classList.add('slideshow-playing');
 }catch(e){
  document.getElementById('slideshow-help')?.classList.remove('hidden');
 }
 render();
}
function exitSlideshow(){if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen();document.body.classList.remove('slideshow-playing');render()}
document.body.classList.toggle('screen-mode',view==='screen');
document.body.classList.toggle('player-mode',view==='player');
document.addEventListener('fullscreenchange',()=>{document.body.classList.toggle('slideshow-playing',!!document.fullscreenElement);if(state)render()});

async function api(b){const r=await fetch(endpointPrefix+'/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');return j}
async function host(op,extra={}){unlockAudio();try{await api({op,hostKey,...extra})}catch(e){alert(e.message);if(e.message==='Incorrect host key'){sessionStorage.removeItem('qm_host');hostKey='';render()}}}
let audioContext=null,soundEnabled=false,lastTickKey='',suspenseTimer=null,correctSound=null,victorySound=null,victoryPlayedFor=null;
fetch('/correct-answer.b64').then(r=>r.ok?r.text():Promise.reject(Error('Missing sound file'))).then(b64=>{correctSound=new Audio('data:audio/mpeg;base64,'+b64.trim());correctSound.preload='auto';correctSound.volume=.9}).catch(e=>console.warn('Unable to load uploaded audio:',e));
function unlockAudio(){if(view==='player')return false;try{audioContext=audioContext||new(window.AudioContext||window.webkitAudioContext)();const p=audioContext.resume();if(p?.catch)p.catch(()=>{});soundEnabled=true;loadVictoryAudio();return true}catch(e){return false}}
function enableSound(){if(view==='player')return;if(!unlockAudio()){alert('Sound unavailable on this device');return}playCorrectAnswer();render();if(state?.phase==='question')startSuspense()}
function note(freq,t,dur,gain=.035,type='sine'){if(view==='player'||!soundEnabled||!audioContext||audioContext.state!=='running')return;const c=audioContext,o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.015);g.gain.setValueAtTime(gain,t+Math.max(.03,dur-.06));g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g).connect(c.destination);o.start(t);o.stop(t+dur+.01)}
let victoryAudioPromise=null;
function loadVictoryAudio(){
 if(victoryAudioPromise)return victoryAudioPromise;
 victoryAudioPromise=fetch('/final-victory.b64',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Victory fanfare resource missing');return r.text()}).then(encoded=>{
  victorySound=new Audio('data:audio/ogg;codecs=opus;base64,'+encoded.trim());
  victorySound.preload='auto';victorySound.loop=false;victorySound.volume=.9;
  return victorySound;
 }).catch(e=>{console.warn('Could not load victory sound',e);return null});
 return victoryAudioPromise;
}
async function playVictoryOnce(){
 if(view==='player'||!soundEnabled||!state||state.phase!=='finished')return;
 const key=state.pin+':'+state.total;
 if(victoryPlayedFor===key)return;
 victoryPlayedFor=key;
 stopSuspense();
 if(correctSound){correctSound.pause();correctSound.currentTime=0}
 try{const audio=await loadVictoryAudio();if(!audio)return;audio.loop=false;audio.pause();audio.currentTime=0;await audio.play()}catch(e){console.warn('Victory sound blocked on this device',e)}
}
function playCorrectAnswer(){if(view==='player'||!soundEnabled)return;try{if(correctSound){correctSound.pause();correctSound.currentTime=0;correctSound.play().catch(e=>console.warn('Correct answer audio blocked:',e))}else if(audioContext){const t=audioContext.currentTime;[523,659,784,1047].forEach((f,i)=>note(f,t+i*.13,.24,.08))}}catch(e){console.warn(e)}}
function playTick(sec){if(view==='player'||!soundEnabled||!audioContext)return;note(sec<=3?940:690,audioContext.currentTime+.01,sec===1?.2:.095,sec<=3?.08:.045)}
function suspensePulse(){if(view==='player')return;if(state?.phase!=='question'||!state.endsAt||Date.now()>=state.endsAt){stopSuspense();return}const remain=Math.ceil((state.endsAt-Date.now())/1000);if(remain<=10)return;if(!soundEnabled||!audioContext)return;const t=audioContext.currentTime+.01;note(164.8,t,.32,.012,'sine');note(196,t+.28,.25,.012,'triangle');note(220,t+.59,.22,.01,'sine')}
// Seamless soundtrack playback: overlapping buffer instances with short cross-fades.
let suspenseAudioBuffer=null,suspenseLoadPromise=null,suspenseMix=null,suspenseSources=[],suspenseNextAt=0,suspenseSequence=null;
function loadSuspenseAudio(){
 if(suspenseLoadPromise)return suspenseLoadPromise;
 suspenseLoadPromise=fetch('/suspense-audio.mp3').then(r=>{if(!r.ok)throw Error('Custom soundtrack not yet uploaded');return r.arrayBuffer()}).then(b=>audioContext.decodeAudioData(b)).then(b=>{suspenseAudioBuffer=b;return b}).catch(()=>null);
 return suspenseLoadPromise;
}
function scheduleSoundtrack(){
 if(!suspenseAudioBuffer||!suspenseMix||!audioContext||state?.phase!=='question')return;
 const ctx=audioContext,overlap=Math.min(.16,suspenseAudioBuffer.duration/8);
 const step=suspenseAudioBuffer.duration-overlap;
 if(step<=0)return;
 while(suspenseNextAt<ctx.currentTime+.6){
   const remaining=(state.endsAt-Date.now())/1000+(suspenseNextAt-ctx.currentTime);
   if(remaining<=0)break;
   const start=suspenseNextAt;
   const clip=ctx.createBufferSource(),gain=ctx.createGain();
   clip.buffer=suspenseAudioBuffer;clip.connect(gain).connect(suspenseMix);
   gain.gain.setValueAtTime(.0001,start);
   gain.gain.linearRampToValueAtTime(.31,start+overlap);
   gain.gain.setValueAtTime(.31,start+Math.max(overlap,suspenseAudioBuffer.duration-overlap));
   gain.gain.linearRampToValueAtTime(.0001,start+suspenseAudioBuffer.duration);
   clip.start(start);clip.stop(start+suspenseAudioBuffer.duration);
   suspenseSources.push(clip);
   clip.onended=()=>{suspenseSources=suspenseSources.filter(x=>x!==clip)};
   suspenseNextAt+=step;
 }
}
function stopAllQuizAudio(){soundEnabled=false;stopSuspense();if(correctSound){try{correctSound.pause();correctSound.currentTime=0}catch{}}if(victorySound){try{victorySound.pause();victorySound.currentTime=0}catch{}}if(audioContext){try{audioContext.suspend()}catch{}}}
function stopSuspense(){
 if(suspenseTimer!==null){clearInterval(suspenseTimer);suspenseTimer=null}
 if(suspenseMix&&audioContext){const t=audioContext.currentTime;try{suspenseMix.gain.cancelScheduledValues(t);suspenseMix.gain.setValueAtTime(suspenseMix.gain.value,t);suspenseMix.gain.linearRampToValueAtTime(0,t+.13)}catch{}}
 for(const src of suspenseSources){try{src.stop((audioContext?.currentTime||0)+.15)}catch{}}suspenseSources=[];
 suspenseMix=null;suspenseSequence=null;
}
async function startSuspense(){
 if(view==='player'||!soundEnabled||state?.phase!=='question'||Date.now()>=state.endsAt)return;
 const sequence=state.index+':'+state.started;
 if(suspenseSequence===sequence&&suspenseTimer!==null)return;
 stopSuspense();suspenseSequence=sequence;
 const buffer=await loadSuspenseAudio();
 if(state?.phase!=='question'||Date.now()>=state.endsAt||!soundEnabled||suspenseSequence!==sequence)return;
 if(!buffer){suspensePulse();suspenseTimer=setInterval(suspensePulse,1080);return}
 suspenseMix=audioContext.createGain();suspenseMix.gain.value=1;suspenseMix.connect(audioContext.destination);
 suspenseNextAt=audioContext.currentTime+.04;
 scheduleSoundtrack();
 suspenseTimer=setInterval(()=>{if(state?.phase!=='question'||Date.now()>=state.endsAt)stopSuspense();else scheduleSoundtrack()},140);
}
function soundControl(){return !soundEnabled?'<button class="soundbutton" onclick="enableSound()">🔊 Enable quiz sounds (tap once)</button>':'<button class="soundbutton sound-on" onclick="playCorrectAnswer()">🔊 Test correct-answer sound</button>'}
function animatedBorder(){return '<svg class="travel-outline" viewBox="0 0 1000 240" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><radialGradient id="dotSoftGlow"><stop offset="0%" stop-color="#f5fffa" stop-opacity=".98"/><stop offset="28%" stop-color="#c9fff4" stop-opacity=".83"/><stop offset="65%" stop-color="#a1f8e8" stop-opacity=".32"/><stop offset="100%" stop-color="#a1f8e8" stop-opacity="0"/></radialGradient></defs><path class="orbit-path" d="M100 3 L900 3 L997 120 L900 237 L100 237 L3 120 Z" fill="none" stroke="none"/><g class="orbit-dot"><circle r="26" fill="url(#dotSoftGlow)"/><circle r="5" fill="#f7fffb"/></g></svg>'}
let glowFrame=0,glowStart=0;
function animateGlow(timestamp){
 if(!glowStart)glowStart=timestamp;
 const dots=document.querySelectorAll('.travel-outline');
 if(dots.length){
  const fraction=((timestamp-glowStart)%5000)/5000;
  dots.forEach(svg=>{const path=svg.querySelector('.orbit-path'),dot=svg.querySelector('.orbit-dot');if(!path||!dot)return;const length=path.getTotalLength(),pt=path.getPointAtLength(fraction*length);dot.setAttribute('transform','translate('+pt.x.toFixed(3)+' '+pt.y.toFixed(3)+')')});
 }
 glowFrame=requestAnimationFrame(animateGlow);
}
function startGlow(){if(view==='screen'&&!glowFrame&&typeof requestAnimationFrame==='function')glowFrame=requestAnimationFrame(animateGlow)}
function questionFontSize(prompt){const len=String(prompt||'').length;return len>185?19:len>145?21:len>110?23:len>82?25:29}
function fitQuestionText(){document.querySelectorAll('.question-copy').forEach(n=>{const holder=n.closest('.ppt-prompt');if(!holder)return;let size=questionFontSize(n.textContent),maxHeight=holder.clientHeight-18;n.style.fontSize=size+'px';while(size>17&&n.scrollHeight>maxHeight){size--;n.style.fontSize=size+'px'}})}
function fitHostQuestion(){document.querySelectorAll('[data-fit-host]').forEach(n=>{let size=testMode?56:48;n.style.fontSize=size+'px';const parent=n.closest('.host-content');const allowance=parent?Math.max(105,parent.clientHeight*.52):280;while(size>22&&(n.scrollHeight>allowance||n.scrollWidth>n.clientWidth+2)){size-=2;n.style.fontSize=size+'px'}})}
function confetti(){let pieces='';const colors=['#f1792c','#fff','#ffd54b','#086b59','#ed3434','#1878ff'];for(let i=0;i<76;i++){const x=(i*37.37)%100,delay=((i*13)%35)/10,duration=3+((i*7)%24)/10;pieces+='<i style="--x:'+x+'%;--delay:'+delay+'s;--speed:'+duration+'s;--c:'+colors[i%colors.length]+';--spin:'+(i%2?'720deg':'-540deg')+'"></i>'}return '<div class="confetti" aria-hidden="true">'+pieces+'</div>'}
function challengeLabel(r){return r===1?'What Word Comes After':r===2?'What Word Comes Before':r===3?'What Word Ends with &ldquo;TRY&rdquo;':'2 Meanings 1 Word'}
function scores(){return '<div class="ppt-scores">'+['A','B'].map(t=>'<div class="ppt-score team-'+t.toLowerCase()+' '+(state.results?.roundWinner===t?'highlight':'')+'"><span>TEAM-'+t+'</span><strong>'+state.scores[t]+'</strong><small>POINTS'+(state.results?' · +'+state.results.round[t]+' this question':'')+'</small>'+(state.results?.roundWinner===t?'<em>WINNER</em>':'')+'</div>').join('')+'</div>'}
function banner(round){const label=challengeLabel(round);return '<div class="ppt-ribbon"><svg class="ribbon-art" viewBox="0 0 1100 130" preserveAspectRatio="none" aria-hidden="true"><path d="M14 32 L283 20 L284 104 L14 121 L149 77 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M1086 32 L817 20 L816 104 L1086 121 L951 77 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M282 10 L818 10 L818 106 L282 106 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M306 106 L415 122 L415 106 M685 106 L685 122 L794 106" fill="none" stroke="white" stroke-width="2"/></svg><div class="ribbon-caption"><span>The Quiz Master Show:</span><span>Word Challenge: '+label+'</span></div></div>'}
function questionPanel(q){return '<div class="question-track"><div class="ppt-prompt"><span class="question-copy" data-target-size="'+questionFontSize(q.prompt)+'">'+esc(q.prompt)+'</span></div></div>'}
function question(){const q=state.question;return '<div class="ppt-question '+(q.words?.length?'word-mode':'definition-mode')+'">'+banner(q.round)+questionPanel(q)+(q.words?.length?'<div class="ppt-words">'+q.words.map(w=>'<div class="ppt-hex">'+esc(w)+'</div>').join('')+'</div>':'')+'</div>'}
function results(){const r=state.results,q=state.question;return '<div class="ppt-stage '+(q.words?.length?'word-slide':'definition-slide')+' results-stage"><div class="ppt-question '+(q.words?.length?'word-mode':'definition-mode')+'">'+banner(q.round)+questionPanel(q)+(r.completed?.length?'<div class="ppt-words">'+r.completed.map(w=>'<div class="ppt-hex revealed">'+esc(w)+'</div>').join('')+'</div>':'')+'</div><div class="ppt-answer">'+esc(r.correct)+'</div><div class="ppt-outcome">'+(r.roundWinner==='draw'?'ROUND DRAW — EQUAL POINTS':'TEAM '+r.roundWinner+' WINS THIS QUESTION!')+'</div><div class="ppt-fast">⚡ FASTEST CORRECT: '+(r.fast?esc(r.fast.name)+' (TEAM '+r.fast.team+' · '+r.fast.seconds.toFixed(1)+'s)':'No correct answer submitted')+'</div>'+scores()+'</div>'}
function finale(){const a=state.scores.A,b=state.scores.B,w=a===b?'draw':a>b?'A':'B';const winners=w==='draw'?['A','B']:[w];const names=winners.map(t=>'<div class="winner-team"><div class="winner-team-name">TEAM '+t+'</div><div class="winner-member-names">'+(state.players.filter(p=>p.team===t).map(p=>esc(p.name)).join(', ')||'')+'</div></div>').join('');return '<div class="ppt-stage finale-stage">'+confetti()+'<div class="ppt-ribbon"><svg class="ribbon-art" viewBox="0 0 1100 130" preserveAspectRatio="none" aria-hidden="true"><path d="M14 32 L283 20 L284 104 L14 121 L149 77 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M1086 32 L817 20 L816 104 L1086 121 L951 77 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M282 10 L818 10 L818 106 L282 106 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M306 106 L415 122 L415 106 M685 106 L685 122 L794 106" fill="none" stroke="white" stroke-width="2"/></svg><div class="ribbon-caption"><span>The Quiz Master Show:</span><span>Quiz Complete!</span></div></div><h1 class="ppt-final">'+(w==='draw'?"IT'S A TIE! CONGRATULATIONS TO BOTH TEAMS!":'CONGRATULATIONS TEAM '+w+'!')+'</h1><div class="winning-members">'+names+'</div><div class="final-tally"><div class="final-tally-title">FINAL SCORES</div><div class="final-tally-grid"><div class="final-tally-team final-a"><span>TEAM A</span><strong>'+a+'</strong><small>POINTS</small></div><div class="final-tally-team final-b"><span>TEAM B</span><strong>'+b+'</strong><small>POINTS</small></div></div></div></div>'}
function sectionScreen(){return '<div class="ppt-stage opening-stage"><div class="title-hex"><span>Word Challenge '+state.sectionRound+'</span></div></div>'}
function screen(){if(state.phase==='lobby')return '<div class="ppt-stage opening-stage"><div class="title-hex"><span>Word Challenge 1</span></div></div>';if(state.phase==='section')return sectionScreen();if(state.phase==='finished')return finale();if(state.phase==='results')return results();return '<div class="ppt-stage '+(state.question.words?.length?'word-slide':'definition-slide')+'">'+question()+'<div class="ppt-count"><span class="timer" id="clock"></span></div>'+scores()+'</div>'}
// Standalone font-size proof: identical host content/scoreboard geometry but no live actions.
const hostPreviewMode=new URLSearchParams(location.search).get('preview')==='longest';
document.body.classList.toggle('single-preview-mode',hostPreviewMode);
const hostPreviewQuestion="What is the word for feeling well or in good health and also a term used for money paid as a penalty for breaking  a rule or law?";
let hostPreviewFont=56; // 48px baseline + 8px = approximately six typographic points.
function adjustHostPreview(delta){hostPreviewFont=Math.max(44,Math.min(72,hostPreviewFont+delta));render()}
function hostFontPreview(){
 return '<div class="single-question-preview"><div class="single-question-inner"><div class="single-question-category">WORD CHALLENGE 4 · LONGEST QUESTION</div><div class="single-question-text" style="font-size:'+hostPreviewFont+'px">'+esc(hostPreviewQuestion)+'</div></div><div class="single-question-toolbar"><span>'+hostPreviewFont+' px</span><button onclick="adjustHostPreview(-2)" aria-label="Reduce font size">A−</button><button onclick="adjustHostPreview(2)" aria-label="Increase font size">A+</button><button onclick="previewFullscreen()">⛶ Full Screen</button></div></div>'
}
async function previewFullscreen(){try{if(document.fullscreenElement){await document.exitFullscreen()}else if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen({navigationUI:'hide'})}else if(document.documentElement.webkitRequestFullscreen){document.documentElement.webkitRequestFullscreen()}else{alert('This browser does not support website fullscreen. Try a desktop browser.') }}catch(e){alert('Fullscreen is not available in this browser. You can still view the question on this page.')}}
function hostView(){
if(hostPreviewMode)return hostFontPreview();
if(!hostKey)return '<div class="panel"><h2>Host login</h2><p>Enter the private host password set in Render.</p><input id="hostkey" type="password" placeholder="Host password"><button onclick="hostKey=document.getElementById(\'hostkey\').value;sessionStorage.setItem(\'qm_host\',hostKey);render()">Open dashboard</button></div>';
const active=state.phase!=='lobby';
const header=active
?'<div class="host-topbar"><div class="host-heading"><b>'+ (testMode?'ONE-QUESTION LIVE TEST':'HOST CONTROL') +'</b><small>Word Challenge '+state.sectionRound+' · '+(state.phase==='finished'?'Complete':'Question '+(state.index+1)+' / '+state.total)+'</small></div><span class="host-info">PIN <strong>'+state.pin+'</strong></span><span class="host-info">Players <strong>'+state.players.length+' / '+state.capacity+'</strong></span><a class="host-screen-link" href="/?view=screen'+(testMode?'&test=1':'')+'" target="_blank">Presentation ↗</a><a class="host-preview-link" href="/?view=host&preview=longest" target="_blank">Font Preview ↗</a></div>'
:'<div class="host-topbar"><div class="host-heading"><b>HOST DASHBOARD</b><small>Registration and team assignments</small></div><span class="host-info">Game PIN <strong>'+state.pin+'</strong></span><span class="host-info">Registered <strong>'+state.players.length+' / '+state.capacity+'</strong></span><a class="host-screen-link" href="/?view=screen'+(testMode?'&test=1':'')+'" target="_blank">Presentation ↗</a><a class="host-preview-link" href="/?view=host&preview=longest" target="_blank">Font Preview ↗</a></div>';
if(!active){
const demoSetup=testMode?'<div class="demo-setup"><strong>Two-player quick test</strong><span>No phones needed to test the quiz layout and scores.</span><button class="host-primary" onclick="host(\'demoPlayers\')">Create 2 Test Players Automatically</button></div>':'';
return '<div class="host-console host-lobby">'+header+demoSetup+'<div class="host-registration"><h2>Assign Teams</h2><div class="players">'+state.players.map(p=>'<div class="player"><b>'+esc(p.name)+'</b><p>'+(p.team?'Team '+p.team:'Unassigned')+'</p><button onclick="host(\'team\',{id:\''+p.id+'\',team:\'A\'})">Team A</button> <button onclick="host(\'team\',{id:\''+p.id+'\',team:\'B\'})">Team B</button></div>').join('')+'</div></div><div class="host-prestart"><label for="duration">Question timer</label><input id="duration" type="number" min="5" max="300" value="'+state.duration+'"><button class="secondary" onclick="host(\'duration\',{seconds:Number(document.getElementById(\'duration\').value)})">Save</button><button class="host-primary" onclick="host(\'start\')">Start Word Challenge '+(testMode?'4':'1')+'</button></div></div>'
}
let title='',content='',action='';
if(state.phase==='section'){
title='Word Challenge '+state.sectionRound;
content='<div class="host-section-title">'+title+'</div><p class="host-muted">Ready to display Question '+(state.index+1)+'</p>';
action='<button class="host-primary" onclick="host(\'next\')">Show Question '+(state.index+1)+' →</button>';
}else if(state.phase==='question'){
const q=state.question;
title='Question '+(state.index+1)+' of '+state.total;
content='<div class="host-question-label">WORD CHALLENGE '+q.round+'</div><div class="host-question-text" data-fit-host="true">'+esc(q.prompt)+'</div>'+(q.words?.length?'<div class="host-word-row">'+q.words.map(w=>'<span>'+esc(w)+'</span>').join('')+'</div>':'')+'<div class="host-answer-status"><span class="host-timer" id="clock"></span><span>'+state.answered+' / '+state.players.length+' answers received</span></div>'+(testMode?'<div class="demo-submit"><span>SIMULATE PLAYER ANSWERS</span><button onclick="host(\'demoAnswer\',{team:\'A\'})">Submit Team A Correct</button><button onclick="host(\'demoAnswer\',{team:\'B\'})">Submit Team B Correct</button></div>':'');
action='<button class="host-primary" onclick="host(\'reveal\')">Close Answers & Reveal Results</button>';
}else if(state.phase==='results'){
const r=state.results;
title='Question '+(state.index+1)+' Results';
content='<div class="host-answer-label">CORRECT ANSWER</div><div class="host-answer">'+esc(r.correct)+'</div>'+(r.completed?.length?'<div class="host-word-row">'+r.completed.map(w=>'<span>'+esc(w)+'</span>').join('')+'</div>':'')+'<div class="host-result-winner">'+(r.roundWinner==='draw'?'ROUND DRAW':('TEAM '+r.roundWinner+' WINS THIS QUESTION'))+'</div><div class="host-fastest">⚡ '+(r.fast?'Fastest: '+esc(r.fast.name)+' · Team '+r.fast.team+' · '+r.fast.seconds.toFixed(1)+'s':'No correct answers')+'</div><div class="host-round-points">This question: Team A +'+r.round.A+' · Team B +'+r.round.B+'</div>';
action='<button class="host-primary" onclick="host(\'next\')">'+(state.index+1===state.total?'Finish Quiz':'Next Question →')+'</button>';
}else{
title='Quiz Complete';
const winner=state.scores.A===state.scores.B?'Both Teams':state.scores.A>state.scores.B?'Team A':'Team B';
content='<div class="host-section-title">Congratulations '+winner+'!</div><p class="host-muted">Final scores</p>';
}
const timerControl=['section','results'].includes(state.phase)?'<div class="host-timer-control"><label for="duration">Next timer</label><input id="duration" type="number" min="5" max="300" value="'+state.duration+'"><button class="secondary" onclick="host(\'duration\',{seconds:Number(document.getElementById(\'duration\').value)})">Save</button></div>':'';
const reset='<button class="host-reset" onclick="if(confirm(\'Reset quiz and registered players?\')){host(\'reset\');localStorage.removeItem(\'qm_player\'+sessionSuffix);localStorage.removeItem(\'qm_token\'+sessionSuffix)}">Reset quiz</button>';
return '<div class="host-console host-active">'+header+'<div class="host-main"><div class="host-content"><h2>'+title+'</h2>'+content+'</div><aside class="host-sidebar"><div class="host-side-title">CUMULATIVE SCORES</div><div class="host-team-score host-team-a"><span>TEAM A</span><strong>'+state.scores.A+'</strong></div><div class="host-team-score host-team-b"><span>TEAM B</span><strong>'+state.scores.B+'</strong></div><div class="host-side-note">'+state.players.length+' registered players</div></aside></div><div class="host-controls">'+timerControl+action+reset+'</div></div>'
}
function playerView(){
const p=state.players.find(x=>x.id===playerId);
if(!p||!playerToken)return '<div class="player-app"><div class="mobile-card"><p class="eyebrow">THE QUIZ MASTER SHOW</p><h2>Join the game</h2><label for="name">Your name</label><input id="name" maxlength="50" placeholder="Full name"><label for="phone">Mobile number</label><input id="phone" inputmode="tel" placeholder="Use a test number"><label for="pin">Game PIN</label><input id="pin" inputmode="numeric" maxlength="6" placeholder="6-digit PIN"><button class="submit-button" onclick="join()">Join quiz</button><p class="muted">For testing, use a test number rather than your real mobile number.</p></div></div>';
const head='<div class="mobile-head"><div><small>THE QUIZ MASTER SHOW</small><strong>'+esc(p.name)+'</strong></div><span class="team-chip team-chip-'+(p.team||'waiting')+'">'+(p.team?'Team '+p.team:'Unassigned')+'</span></div>';
if(state.phase==='lobby')return '<div class="player-app">'+head+'<div class="mobile-card centered"><h2>Ready to play?</h2><p>'+(p.team?'You are in Team '+p.team:'The host will assign your team')+'</p><p class="muted">Waiting for the host to start.</p></div></div>';
if(state.phase==='section')return '<div class="player-app">'+head+'<div class="mobile-card centered"><p class="eyebrow">NEXT ROUND</p><h2>Word Challenge '+state.sectionRound+'</h2><p class="muted">The host will begin shortly.</p></div></div>';
if(state.phase==='finished')return '<div class="player-app player-finale">'+finale()+'</div>';
if(state.phase==='results'){
const r=state.results;
return '<div class="player-app">'+head+'<div class="mobile-card centered"><div class="mobile-category">Word Challenge: '+challengeLabel(state.question.round)+'</div><p class="eyebrow">QUESTION RESULT</p><h2>'+esc(r.correct)+'</h2>'+(r.completed?.length?'<div class="mobile-reveals">'+r.completed.map(w=>'<span>'+esc(w)+'</span>').join('')+'</div>':'')+'<p class="mobile-winner">'+(r.roundWinner==='draw'?'Round draw':'Team '+r.roundWinner+' wins this question')+'</p><p class="mobile-fast">'+(r.fast?'Fastest correct: '+esc(r.fast.name)+' · Team '+r.fast.team+' · '+r.fast.seconds.toFixed(1)+'s':'No correct responses')+'</p><div class="mobile-scores"><span>Team A: '+state.scores.A+'</span><span>Team B: '+state.scores.B+'</span></div><p class="muted">Waiting for the next question.</p></div></div>'}
const q=state.question,done=submittedFor===state.index;
return '<div class="player-app">'+head+'<div class="mobile-card"><div class="mobile-progress"><span>Challenge '+q.round+' · Question '+(state.index+1)+' of '+state.total+'</span><span class="timer" id="clock"></span></div><div class="mobile-category">Word Challenge: '+challengeLabel(q.round)+'</div><h2 class="mobile-question">'+esc(q.prompt)+'</h2>'+(q.words?.length?'<div class="mobile-words">'+q.words.map(w=>'<span>'+esc(w)+'</span>').join('')+'</div>':'')+(done?'<div class="mobile-success">✓ Your answer has been submitted.</div>':q.type==='choice'?'<div class="mobile-choices">'+q.choices.map((c,i)=>'<button class="mobile-choice '+(selected===c?'selected':'')+'" onclick="choose('+i+')">'+esc(c)+'</button>').join('')+'</div><button class="submit-button" onclick="submitAnswer()">Submit answer</button>':'<label class="answer-label" for="textanswer">Your answer</label><input id="textanswer" maxlength="75" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Type your answer" value="'+esc(selected)+'" oninput="this.value=this.value.replace(/[^a-zA-Z ]/g,\'\').slice(0,75);selected=this.value"><p class="input-note">Letters and spaces only, maximum 75 characters.</p><button class="submit-button" onclick="selected=document.getElementById(\'textanswer\').value;submitAnswer()">Submit answer</button>')+'</div></div>'
}
function choose(i){selected=state.question.choices[i];render()}
async function join(){try{const r=await api({op:'join',name:document.getElementById('name').value,phone:document.getElementById('phone').value,pin:document.getElementById('pin').value});playerId=r.id;playerToken=r.token;localStorage.setItem('qm_player'+sessionSuffix,playerId);localStorage.setItem('qm_token'+sessionSuffix,playerToken);render()}catch(e){alert(e.message)}}
async function submitAnswer(){if(!selected.trim())return alert('Enter or select an answer');try{await api({op:'answer',id:playerId,token:playerToken,answer:selected});submittedFor=state.index;render()}catch(e){alert(e.message)}}
function render(){if(!state&&!hostPreviewMode)return;
const presentationControls=view==='screen'&&!document.fullscreenElement
?'<div class="slideshow-toolbar"><button class="launch-slideshow" onclick="launchSlideshow()">⛶ Full Screen Slideshow</button>'+(!soundEnabled?'<button class="screen-audio-btn" onclick="enableSound()">🔊 Enable Sound</button>':'')+'<div id="slideshow-help" class="slideshow-help hidden">This browser does not allow websites to hide its tabs or address bar. Use a browser with fullscreen support or open this screen from your TV browser in fullscreen mode.</div></div>'
:'';
const otherSound=(view==='screen'||view==='player')?'':soundControl();
el.innerHTML='<div class="view-'+view+'">'+(hostPreviewMode?'':presentationControls+otherSound)+(hostPreviewMode?hostFontPreview():view==='host'?hostView():view==='screen'?screen():playerView())+'</div>';
document.querySelectorAll('.ppt-prompt,.title-hex').forEach(node=>node.insertAdjacentHTML('beforeend',animatedBorder()));fitQuestionText();fitHostQuestion();startGlow();tick()}
function tick(){if(!state?.endsAt||state.phase!=='question')return;if(Date.now()>=state.endsAt){stopSuspense();return;}const secs=Math.max(0,Math.ceil((state.endsAt-Date.now())/1000)),n=document.getElementById('clock');if(n)n.textContent=Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0');const key=state.index+':'+secs;if(secs>=1&&key!==lastTickKey){lastTickKey=key;if(secs<=10)playTick(secs)}}
function applyQuizState(incoming){
 const old=state;
 state=incoming;
 if(old?.phase==='question'&&state.phase!=='question')stopSuspense();
 if(old?.phase==='question'&&state.phase==='results'&&lastResult!==state.index){lastResult=state.index;playCorrectAnswer()}
 if(old&&old.phase!=='finished'&&state.phase==='finished')playVictoryOnce();
 if(old?.index!==state.index){selected='';submittedFor=-1}
 const preserveTyping=view==='player'&&old?.phase==='question'&&state.phase==='question'&&old.index===state.index&&document.activeElement?.id==='textanswer';
 const preserveProjection=view==='screen'&&old&&old.phase===state.phase&&old.index===state.index&&old.sectionRound===state.sectionRound;
 if(!preserveTyping&&!preserveProjection)render();else tick();
 if(state.phase==='question')startSuspense();
}
function showConnectionProblem(){
 if(state)return;
 el.innerHTML='<div class="panel center"><h2>Unable to connect to the test quiz</h2><p>The game server may be starting or the connection was interrupted.</p><button onclick="location.reload()">Reconnect</button><p class="muted">If this continues, open '+(testMode?'the dedicated test link':'the quiz link')+' again in Safari or Chrome.</p></div>';
}
async function refreshQuizState(){
 try{
  const response=await fetch(endpointPrefix+'/state',{cache:'no-store'});
  if(!response.ok)throw Error('Quiz state '+response.status);
  const incoming=await response.json();
  if(!state||connection.readyState!==EventSource.OPEN)applyQuizState(incoming);
 }catch(e){console.warn('Quiz connection issue:',e);showConnectionProblem()}
}
const connection=new EventSource(endpointPrefix+'/events');
connection.onerror=()=>{refreshQuizState()};
connection.onmessage=e=>{try{applyQuizState(JSON.parse(e.data))}catch(error){console.error('Quiz update error:',error);showConnectionProblem()}};
refreshQuizState();
setInterval(()=>{if(connection.readyState!==EventSource.OPEN)refreshQuizState()},4000);
setInterval(tick,250);
if(hostPreviewMode)render();
