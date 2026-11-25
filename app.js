const testMode=new URLSearchParams(location.search).get('test')==='1';
const sessionSuffix=testMode?'_test':'';
const endpointPrefix=testMode?'/test':'';
let view=new URLSearchParams(location.search).get('view')||'host';
let state=null,playerId=localStorage.getItem('qm_player'+sessionSuffix)||'',playerToken=localStorage.getItem('qm_token'+sessionSuffix)||'',hostKey=sessionStorage.getItem('qm_host')||'',selected='',submittedFor=-1,lastResult=-1,submittingAnswer=false;
const el=document.getElementById('app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setView(v){document.querySelectorAll('.quiz-full-bleed-guide').forEach(n=>n.remove());if(v==='player'){stopAllQuizAudio()}view=v;history.replaceState(null,'','?view='+v+(testMode?'&test=1':''));document.body.classList.toggle('screen-mode',v==='screen');document.body.classList.toggle('player-mode',v==='player');render()}
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
document.body.classList.toggle('test-big-screen',testMode&&view==='screen');
document.addEventListener('fullscreenchange',()=>{document.body.classList.toggle('slideshow-playing',!!document.fullscreenElement);if(state)render()});

async function api(b){const r=await fetch(endpointPrefix+'/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');return j}
async function host(op,extra={}){unlockAudio();try{await api({op,hostKey,...extra})}catch(e){alert(e.message);if(e.message==='Incorrect host key'){sessionStorage.removeItem('qm_host');hostKey='';render()}}}
let audioContext=null,soundEnabled=false,lastTickKey='',suspenseTimer=null,correctSound=null,victorySound=null,victoryPlayedFor=null;
fetch('/correct-answer.b64').then(r=>r.ok?r.text():Promise.reject(Error('Missing sound file'))).then(b64=>{correctSound=new Audio('data:audio/mpeg;base64,'+b64.trim());correctSound.preload='auto';correctSound.volume=.9}).catch(e=>console.warn('Unable to load uploaded audio:',e));
function unlockAudio(){if(view==='player')return false;try{audioContext=audioContext||new(window.AudioContext||window.webkitAudioContext)();const p=audioContext.resume();if(p?.catch)p.catch(()=>{});soundEnabled=true;loadVictoryAudio();return true}catch(e){return false}}
function enableSound(){if(view==='player')return;if(!unlockAudio()){alert('Sound unavailable on this device');return}if(state?.phase==='finished')playVictoryOnce();else playCorrectAnswer();render();if(state?.phase==='question')startSuspense()}
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
 try{const audio=await loadVictoryAudio();if(!audio)throw Error('Victory audio unavailable');audio.loop=false;audio.pause();audio.currentTime=0;await audio.play()}catch(e){console.warn('Victory audio unavailable, playing fallback fanfare:',e);if(audioContext&&audioContext.state==='running'){const t=audioContext.currentTime+.03;[523,659,784,1047,784,1047,1319].forEach((f,i)=>note(f,t+i*.17,i===6?.72:.28,.09,'triangle'))}}
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
let glowId=0;
function animatedBorder(mobile=false){const id='dotSoftGlow-'+(++glowId);return '<svg class="travel-outline'+(mobile?' participant-glow':'')+'" viewBox="0 0 1000 240" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><radialGradient id="'+id+'"><stop offset="0%" stop-color="#f5fffa" stop-opacity=".98"/><stop offset="28%" stop-color="#c9fff4" stop-opacity=".83"/><stop offset="65%" stop-color="#a1f8e8" stop-opacity=".32"/><stop offset="100%" stop-color="#a1f8e8" stop-opacity="0"/></radialGradient></defs><path class="orbit-path" d="M100 3 L900 3 L997 120 L900 237 L100 237 L3 120 Z" fill="none" stroke="none"/><g class="orbit-dot"><circle r="26" fill="url(#'+id+')"/><circle r="5" fill="#f7fffb"/></g></svg>'}
let glowFrame=0,glowStart=0;
function animateGlow(timestamp){
 if(!glowStart)glowStart=timestamp;
 const dots=document.querySelectorAll('.travel-outline');
 if(dots.length){
  const fraction=((timestamp-glowStart)%5000)/5000;
  dots.forEach(svg=>{try{const path=svg.querySelector('.orbit-path'),dot=svg.querySelector('.orbit-dot');if(!path||!dot)return;const length=path.getTotalLength(),pt=path.getPointAtLength(fraction*length);let scale='';if(svg.classList.contains('participant-glow')){const w=svg.clientWidth,h=svg.clientHeight;if(w>0&&h>0){const unit=w/1000;const pixelRadius=Math.min(10,26*unit);const radiusScale=pixelRadius/26;scale=' scale('+(radiusScale*1000/w).toFixed(5)+' '+(radiusScale*240/h).toFixed(5)+')'}}dot.setAttribute('transform','translate('+pt.x.toFixed(3)+' '+pt.y.toFixed(3)+')'+scale)}catch(e){/* keep the shared animation running */}});
 }
 glowFrame=requestAnimationFrame(animateGlow);
}
function startGlow(){if(!glowFrame&&typeof requestAnimationFrame==='function')glowFrame=requestAnimationFrame(animateGlow)}
function questionFontSize(prompt){const len=String(prompt||'').length;return len>185?19:len>145?21:len>110?23:len>82?25:29}
function fitQuestionText(){document.querySelectorAll('.question-copy').forEach(n=>{
 const holder=n.closest('.ppt-prompt');if(!holder)return;
 const enlarged=view==='screen';
 let size=questionFontSize(n.textContent)+(enlarged?21.333:0);
 const floor=17;
 const maxHeight=holder.clientHeight-12;
 n.style.fontSize=size+'px';
 while(size>floor&&(n.scrollHeight>maxHeight||n.scrollWidth>n.clientWidth+2)){size--;n.style.fontSize=size+'px'}
})}
function fitHostQuestion(){document.querySelectorAll('[data-fit-host]').forEach(n=>{let size=testMode?56:48;n.style.fontSize=size+'px';const parent=n.closest('.host-content');const allowance=parent?Math.max(105,parent.clientHeight*.52):280;while(size>22&&(n.scrollHeight>allowance||n.scrollWidth>n.clientWidth+2)){size-=2;n.style.fontSize=size+'px'}})}
function confetti(){let pieces='';const colors=['#f1792c','#fff','#ffd54b','#086b59','#ed3434','#1878ff'];for(let i=0;i<76;i++){const x=(i*37.37)%100,delay=((i*13)%35)/10,duration=3+((i*7)%24)/10;pieces+='<i style="--x:'+x+'%;--delay:'+delay+'s;--speed:'+duration+'s;--c:'+colors[i%colors.length]+';--spin:'+(i%2?'720deg':'-540deg')+'"></i>'}return '<div class="confetti" aria-hidden="true">'+pieces+'</div>'}
function challengeLabel(r){return r===1?'What Word Comes After':r===2?'What Word Comes Before':r===3?'What Word Ends with &ldquo;TRY&rdquo;':'2 Meanings 1 Word'}
function teamLabel(t){return esc(state?.teamNames?.[t]||'TEAM '+t)}
function teamNameEditor(){
 const a=esc(state?.teamNames?.A||'TEAM A'),b=esc(state?.teamNames?.B||'TEAM B');
 return `<div class="host-team-naming"><div class="team-editor-title">Team names <small>Optional · defaults: TEAM A / TEAM B</small></div><div class="team-editor-grid"><label for="teamNameA">Team A</label><input id="teamNameA" maxlength="24" value="${a}" autocomplete="off" aria-label="Team A name"><label for="teamNameB">Team B</label><input id="teamNameB" maxlength="24" value="${b}" autocomplete="off" aria-label="Team B name"><button type="button" class="secondary team-save-btn" onclick="saveTeamNames()">Save Names</button></div></div>`;
}
function saveTeamNames(){
 const A=document.getElementById('teamNameA')?.value||'';
 const B=document.getElementById('teamNameB')?.value||'';
 host('teamNames',{names:{A,B}});
}
function scores(){return '<div class="ppt-scores">'+['A','B'].map(t=>'<div class="ppt-score team-'+t.toLowerCase()+' '+(state.results?.roundWinner===t?'highlight':'')+'"><span>'+teamLabel(t)+'</span><strong>'+state.scores[t]+'</strong><small>POINTS'+(state.results?' · +'+state.results.round[t]+' this question':'')+'</small>'+(state.results?.roundWinner===t?'<em>WINNER</em>':'')+'</div>').join('')+'</div>'}
function banner(round){const label=challengeLabel(round);return '<div class="ppt-ribbon"><svg class="ribbon-art" viewBox="0 0 1100 130" preserveAspectRatio="none" aria-hidden="true"><path d="M14 32 L283 20 L284 104 L14 121 L149 77 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M1086 32 L817 20 L816 104 L1086 121 L951 77 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M282 10 L818 10 L818 106 L282 106 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M306 106 L415 122 L415 106 Z M685 106 L685 122 L794 106 Z" fill="#EE752D" stroke="white" stroke-width="2"/></svg><div class="ribbon-caption"><span>The Quiz Master Show:</span><span>Word Challenge: '+label+'</span></div></div>'}
function questionPanel(q){return '<div class="question-track"><div class="ppt-prompt"><span class="question-copy" data-target-size="'+questionFontSize(q.prompt)+'">'+esc(q.prompt)+'</span></div></div>'}
function question(){const q=state.question;return '<div class="ppt-question '+(q.words?.length?'word-mode':'definition-mode')+'">'+banner(q.round)+questionPanel(q)+(q.words?.length?'<div class="ppt-words">'+q.words.map(w=>'<div class="ppt-hex">'+esc(w)+'</div>').join('')+'</div>':'')+'</div>'}
function results(){const r=state.results,q=state.question;return '<div class="ppt-stage '+(q.words?.length?'word-slide':'definition-slide')+' results-stage"><div class="ppt-question '+(q.words?.length?'word-mode':'definition-mode')+'">'+banner(q.round)+questionPanel(q)+(r.completed?.length?'<div class="ppt-words">'+r.completed.map(w=>'<div class="ppt-hex revealed">'+esc(w)+'</div>').join('')+'</div>':'')+'</div><div class="ppt-answer">'+esc(r.correct)+'</div><div class="ppt-outcome">'+(r.roundWinner==='draw'?'ROUND DRAW — EQUAL POINTS':teamLabel(r.roundWinner)+' WINS THIS QUESTION!')+'</div><div class="ppt-fast">⚡ FASTEST CORRECT: '+(r.fast?esc(r.fast.name)+' ('+teamLabel(r.fast.team)+' · '+r.fast.seconds.toFixed(1)+'s)':'No correct answer submitted')+'</div>'+scores()+'</div>'}
function finale(){const a=state.scores.A,b=state.scores.B,w=a===b?'draw':a>b?'A':'B';const winners=w==='draw'?['A','B']:[w];const names=winners.map(t=>'<div class="winner-team"><div class="winner-team-name">'+teamLabel(t)+'</div><div class="winner-member-names">'+(state.players.filter(p=>p.team===t).map(p=>esc(p.name)).join(', ')||'')+'</div></div>').join('');return '<div class="ppt-stage finale-stage">'+confetti()+'<div class="ppt-ribbon"><svg class="ribbon-art" viewBox="0 0 1100 130" preserveAspectRatio="none" aria-hidden="true"><path d="M14 32 L283 20 L284 104 L14 121 L149 77 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M1086 32 L817 20 L816 104 L1086 121 L951 77 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M282 10 L818 10 L818 106 L282 106 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M306 106 L415 122 L415 106 Z M685 106 L685 122 L794 106 Z" fill="#EE752D" stroke="white" stroke-width="2"/></svg><div class="ribbon-caption"><span>The Quiz Master Show:</span><span>Quiz Complete!</span></div></div><h1 class="ppt-final">'+(w==='draw'?"IT'S A TIE! CONGRATULATIONS TO BOTH TEAMS!":'CONGRATULATIONS '+teamLabel(w)+'!')+'</h1><div class="winning-members">'+names+'</div><div class="final-tally"><div class="final-tally-title">FINAL SCORES</div><div class="final-tally-grid"><div class="final-tally-team final-a"><span>'+teamLabel('A')+'</span><strong>'+a+'</strong><small>POINTS</small></div><div class="final-tally-team final-b"><span>'+teamLabel('B')+'</span><strong>'+b+'</strong><small>POINTS</small></div></div></div></div>'}
function sectionScreen(){return '<div class="ppt-stage opening-stage"><div class="title-hex"><span>Word Challenge '+state.sectionRound+'</span></div></div>'}
function screen(){if(state.phase==='lobby')return '<div class="ppt-stage opening-stage"><div class="title-hex"><span>Word Challenge '+(testMode?'4':'1')+'</span></div></div>';if(state.phase==='section')return sectionScreen();if(state.phase==='finished')return finale();if(state.phase==='results')return results();return '<div class="ppt-stage '+(state.question.words?.length?'word-slide':'definition-slide')+'">'+question()+'<div class="ppt-count"><span class="timer" id="clock"></span></div>'+scores()+'</div>'}
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
function hostFlashLabel(){
 if(!state)return '';
 const label=state.phase==='lobby'?'Word Challenge':state.phase==='section'?'Word Challenge '+state.sectionRound:state.phase==='question'||state.phase==='results'?'QUESTION '+(state.index+1):'QUIZ COMPLETE';
 return '<div class="host-glow-shape"><span>'+esc(label)+'</span></div>';
}
function hostView(){
if(hostPreviewMode)return hostFontPreview();
if(!hostKey)return '<div class="panel"><h2>Host login</h2><p>Enter the private host password set in Render.</p><input id="hostkey" type="password" placeholder="Host password"><button onclick="hostKey=document.getElementById(\'hostkey\').value;sessionStorage.setItem(\'qm_host\',hostKey);render()">Open dashboard</button></div>';
const active=state.phase!=='lobby';
const header=active
?'<div class="host-topbar"><div class="host-heading"><b>'+ (testMode?'ONE-QUESTION LIVE TEST':'HOST CONTROL') +'</b><small>Word Challenge '+state.sectionRound+' · '+(state.phase==='finished'?'Complete':'Question '+(state.index+1)+' / '+state.total)+'</small></div><span class="host-info">PIN <strong>'+state.pin+'</strong></span><span class="host-info">Players <strong>'+state.players.length+' / '+state.capacity+'</strong></span><a class="host-screen-link" href="/?view=screen'+(testMode?'&test=1':'')+'" target="_blank">Presentation ↗</a><a class="host-preview-link" href="/?view=host&preview=longest" target="_blank">Font Preview ↗</a></div>'
:'<div class="host-topbar"><div class="host-heading"><b>HOST DASHBOARD</b><small>Registration and team assignments</small></div><span class="host-info">Game PIN <strong>'+state.pin+'</strong></span><span class="host-info">Registered <strong>'+state.players.length+' / '+state.capacity+'</strong></span><a class="host-screen-link" href="/?view=screen'+(testMode?'&test=1':'')+'" target="_blank">Presentation ↗</a><a class="host-preview-link" href="/?view=host&preview=longest" target="_blank">Font Preview ↗</a></div>';
if(!active){
const demoSetup=testMode?'<div class="demo-setup"><strong>Word Challenge 4 — Question 30</strong><span>Enter both player names below, one for each team. Each player then joins using the same name and Game PIN on their own device.</span><div class="test-manual-add"><input id="testPlayerA" maxlength="50" placeholder="Team A player name" aria-label="Team A player name"><button onclick="host(\'addTestPlayer\',{name:document.getElementById(\'testPlayerA\').value,team:\'A\'})">Add to Team A</button><input id="testPlayerB" maxlength="50" placeholder="Team B player name" aria-label="Team B player name"><button onclick="host(\'addTestPlayer\',{name:document.getElementById(\'testPlayerB\').value,team:\'B\'})">Add to Team B</button></div><a class="host-screen-link" href="/?view=player&test=1" target="_blank">Player registration ↗</a></div>':'';
return '<div class="host-console host-lobby">'+header+hostFlashLabel()+demoSetup+teamNameEditor()+'<div class="host-registration"><h2>Assign Teams</h2><div class="players">'+state.players.map(p=>'<div class="player"><b>'+esc(p.name)+'</b><p>'+(p.team?teamLabel(p.team):'Unassigned')+'</p><button onclick="host(\'team\',{id:\''+p.id+'\',team:\'A\'})">'+teamLabel('A')+'</button> <button onclick="host(\'team\',{id:\''+p.id+'\',team:\'B\'})">'+teamLabel('B')+'</button></div>').join('')+'</div></div><div class="host-prestart"><label for="duration">Question timer</label><input id="duration" type="number" min="5" max="300" value="'+state.duration+'"><button class="secondary" onclick="host(\'duration\',{seconds:Number(document.getElementById(\'duration\').value)})">Save</button><button class="host-primary" onclick="host(\'start\')">Start Word Challenge '+(testMode?'4':'1')+'</button></div></div>'
}
let title='',content='',action='';
if(state.phase==='section'){
title='Word Challenge '+state.sectionRound;
content='<div class="host-section-title">'+title+'</div><p class="host-muted">Ready to display Question '+(state.index+1)+'</p>';
action='<button class="host-primary" onclick="host(\'next\')">Show Question '+(state.index+1)+' →</button>';
}else if(state.phase==='question'){
const q=state.question;
title='Question '+(state.index+1)+' of '+state.total;
content='<div class="host-question-label">WORD CHALLENGE '+q.round+'</div><div class="host-question-text" data-fit-host="true">'+esc(q.prompt)+'</div>'+(q.words?.length?'<div class="host-word-row">'+q.words.map(w=>'<span>'+esc(w)+'</span>').join('')+'</div>':'')+'<div class="host-answer-status"><span class="host-timer" id="clock"></span><span>'+state.answered+' / '+state.players.length+' answers received</span></div>';
action='<button class="host-primary" onclick="host(\'reveal\')">Close Answers & Reveal Results</button>';
}else if(state.phase==='results'){
const r=state.results;
title='Question '+(state.index+1)+' Results';
content='<div class="host-answer-label">CORRECT ANSWER</div><div class="host-answer">'+esc(r.correct)+'</div>'+(r.completed?.length?'<div class="host-word-row">'+r.completed.map(w=>'<span>'+esc(w)+'</span>').join('')+'</div>':'')+'<div class="host-result-winner">'+(r.roundWinner==='draw'?'ROUND DRAW':(teamLabel(r.roundWinner)+' WINS THIS QUESTION'))+'</div><div class="host-fastest">⚡ '+(r.fast?'Fastest: '+esc(r.fast.name)+' · '+teamLabel(r.fast.team)+' · '+r.fast.seconds.toFixed(1)+'s':'No correct answers')+'</div><div class="host-round-points">This question: '+teamLabel('A')+' +'+r.round.A+' · '+teamLabel('B')+' +'+r.round.B+'</div>';
action='<button class="host-primary" onclick="host(\'next\')">'+(state.index+1===state.total?'Finish Quiz':'Next Question →')+'</button>';
}else{
title='Quiz Complete';
const winner=state.scores.A===state.scores.B?'Both Teams':state.scores.A>state.scores.B?teamLabel('A'):teamLabel('B');
const winningTeams=state.scores.A===state.scores.B?['A','B']:[state.scores.A>state.scores.B?'A':'B'];const memberSummary=winningTeams.map(t=>'<div class="host-winner-group"><strong>'+teamLabel(t)+'</strong><div>'+state.players.filter(p=>p.team===t).map(p=>esc(p.name)).join(', ')+'</div></div>').join('');content='<div class="host-completion">'+confetti()+'<div class="host-section-title">Congratulations '+winner+'!</div><p class="host-muted">Final scores</p><div class="host-winner-members"><h3>Winning team members</h3>'+memberSummary+'</div></div>';
}
const timerControl=['section','results'].includes(state.phase)?'<div class="host-timer-control"><label for="duration">Next timer</label><input id="duration" type="number" min="5" max="300" value="'+state.duration+'"><button class="secondary" onclick="host(\'duration\',{seconds:Number(document.getElementById(\'duration\').value)})">Save</button></div>':'';
const reset='<button class="host-reset" onclick="if(confirm(\'Reset quiz and registered players?\')){host(\'reset\');localStorage.removeItem(\'qm_player\'+sessionSuffix);localStorage.removeItem(\'qm_token\'+sessionSuffix)}">Reset quiz</button>';
return '<div class="host-console host-active">'+header+'<div class="host-main"><div class="host-content">'+hostFlashLabel()+'<h2>'+title+'</h2>'+content+'</div><aside class="host-sidebar"><div class="host-side-title">CUMULATIVE SCORES</div><div class="host-team-score host-team-a"><span>'+teamLabel('A')+'</span><strong>'+state.scores.A+'</strong></div><div class="host-team-score host-team-b"><span>'+teamLabel('B')+'</span><strong>'+state.scores.B+'</strong></div><div class="host-side-note">'+state.players.length+' registered players</div><details class="host-team-rename-details"><summary>Rename Teams</summary>'+teamNameEditor()+'</details></aside></div><div class="host-controls">'+timerControl+action+reset+'</div></div>'
}
function quizTitle(){return "The Quiz Master Show"}
function participantSlide(q,revealed=false){
 const r=revealed?state.results:null;
 const values=revealed?(r?.completed||[]):(q.words||[]);
 const isChoice=q.type==='choice';
 const shapes=values.length?`<div class="ppt-words participant-options">${values.map((word,i)=>{
  let className='ppt-hex'+(revealed?' revealed':'')+(isChoice&&revealed?(word===r.correct?' correct-choice':' incorrect-choice'):'');
  if(isChoice&&!revealed)return `<button type="button" class="${className} participant-pick ${selected===word?'selected':''}" onclick="choose(${i})" aria-pressed="${selected===word}"><span class="participant-option-label">${esc(word)}</span></button>`;
  return `<div class="${className}"><span class="participant-option-label">${esc(word)}</span></div>`;
 }).join('')}</div>`:'';
 const answerClass=q.round===3?'answer-green':q.round===2?'answer-mcq':'answer-orange';
 const info=revealed?`
  <div class="ppt-answer participant-answer ${answerClass}">${q.round===2?'CORRECT ANSWER: ':''}${esc(r.correct)}</div>
  <div class="ppt-outcome participant-outcome">${r.roundWinner==='draw'?'ROUND DRAW — EQUAL POINTS':teamLabel(r.roundWinner)+' WINS THIS QUESTION!'}</div>
  <div class="ppt-fast participant-fast">⚡ FASTEST CORRECT: ${r.fast?esc(r.fast.name)+' ('+teamLabel(r.fast.team)+' · '+r.fast.seconds.toFixed(1)+'s)':'No correct answer submitted'}</div>`:'';
 const scores=`<div class="participant-scoreboard">${['A','B'].map(t=>`<div class="participant-score team-${t.toLowerCase()} ${r?.roundWinner===t?'highlight':''}"><span>${teamLabel(t)}</span><strong>${state.scores[t]}</strong>${revealed?`<small>+${r.round[t]} this question</small>`:''}</div>`).join('')}</div>`;
 return `<section class="participant-preview ${revealed?'participant-revealed':''} category-${q.round}">
  ${banner(q.round)}
  <div class="participant-question-track"><div class="ppt-prompt"><span class="question-copy">${esc(q.prompt)}</span>${animatedBorder(true)}</div></div>
  ${shapes}${info}${scores}
 </section>`;
}
function participantIntro(label){
 return `<section class="participant-preview participant-intro ${state.phase==='lobby'?'participant-opening':'participant-category'}"><div class="title-hex"><span>${esc(label)}</span>${animatedBorder(true)}</div></section>`;
}
function playerView(){
 const p=state.players.find(x=>x.id===playerId);
 if(!p||!playerToken)return `<div class="player-app"><div class="mobile-card"><p class="eyebrow">${quizTitle().toUpperCase()}</p><h2>${testMode?'Join the one-question test':'Join the game'}</h2>
  <label for="name">Your name</label><input id="name" maxlength="50" placeholder="${testMode?'Exactly as entered by Host':'Full name'}">
  ${testMode?'':`<label for="phone">Mobile number</label><input id="phone" inputmode="tel" placeholder="Use a test number">`}
  <label for="pin">Game PIN</label><input id="pin" inputmode="numeric" maxlength="6" placeholder="6-digit PIN">
  <button class="submit-button" onclick="join()">Join quiz</button><p class="muted">${testMode?'The Host must add your name first. Enter the same spelling and PIN shown on the Host screen.':'For testing, use a test number rather than your real mobile number.'}</p></div></div>`;
 const head=`<div class="mobile-head"><div><small>${quizTitle().toUpperCase()}</small><strong>${esc(p.name)}</strong></div><span class="team-chip team-chip-${p.team||'waiting'}">${p.team?teamLabel(p.team):'Unassigned'}</span></div>`;
 if(state.phase==='lobby')return `<div class="player-app">${head}${participantIntro(quizTitle())}<div class="mobile-card centered"><h2>Ready to play?</h2><p>${p.team?'You are in '+teamLabel(p.team):'The Host will assign your team'}</p><p class="muted">Waiting for the Host to start.</p></div></div>`;
 if(state.phase==='section'){
  const name=quizTitle()==='The Christmas Quiz'?'Christmas Trivia - '+state.sectionRound:'Word Challenge '+state.sectionRound;
  const mcqReminder=quizTitle()==='The Christmas Quiz'&&state.sectionRound===2?'<p class="participant-mcq-instruction">FOR THIS SECTION ONLY, DO NOT TYPE YOUR ANSWER. SELECT YOUR OPTION FROM THE CHOICES PROVIDED.</p>':'';
  return `<div class="player-app">${head}${participantIntro(name)}<div class="mobile-card centered"><p class="eyebrow">NEXT CATEGORY</p>${mcqReminder}<p class="muted">The Host will begin the next question.</p></div></div>`;
 }
 if(state.phase==='finished')return `<div class="player-app player-finale">${finale()}</div>`;
 const q=state.question,revealed=state.phase==='results',done=submittedFor===state.index;
 const bar=`<div class="participant-timer-bar"><span>${quizTitle()==='The Christmas Quiz'?'Trivia':'Challenge'} ${q.round} · Question ${state.index+1} of ${state.total}</span>${revealed?'<span>ANSWER REVEALED</span>':'<span class="timer" id="clock"></span>'}</div>`;
 let controls='';
 if(revealed)controls=''; // Results, fastest player and both scores now share the one visible presentation, with no redundant waiting panel.
 else if(done)controls=`<div class="mobile-card participant-entry"><div class="mobile-success">✓ Your answer has been submitted.</div><p class="muted">Waiting for the results.</p></div>`;
 else if(q.type==='choice')controls=`<div class="mobile-card participant-entry"><h2>Submit your answer</h2><p class="input-note">Select one of the three answer shapes on the presentation, then submit.</p><div class="participant-selected">Your selection: <strong>${selected?esc(selected):'None selected'}</strong></div><button class="submit-button" onclick="submitAnswer()" ${selected?'':'disabled'}>Submit answer</button></div>`;
 else controls=`<form class="mobile-card participant-entry participant-answer-form" onsubmit="event.preventDefault();submitAnswer()"><label class="answer-label" for="textanswer">Your answer</label><input id="textanswer" maxlength="75" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done" placeholder="Type your answer" value="${esc(selected)}" oninput="this.value=this.value.replace(/[^a-zA-Z ]/g,'').slice(0,75);selected=this.value"><p class="input-note">Letters and spaces only, maximum 75 characters.</p><button type="submit" class="submit-button" ontouchstart="event.preventDefault();submitAnswer()">Submit answer</button></form>`;
 return `<div class="player-app player-game ${revealed?'player-results':'player-question'}">${head}<div class="participant-game-layout"><div class="participant-display">${bar}${participantSlide(q,revealed)}</div>${controls}</div></div>`;
}
function choose(i){selected=state.question.choices[i];render()}
async function join(){try{const r=await api({op:'join',name:document.getElementById('name').value,phone:document.getElementById('phone')?.value||'',pin:document.getElementById('pin').value});playerId=r.id;playerToken=r.token;localStorage.setItem('qm_player'+sessionSuffix,playerId);localStorage.setItem('qm_token'+sessionSuffix,playerToken);render()}catch(e){alert(e.message)}}
async function submitAnswer(){
 if(submittingAnswer||!state||state.phase!=='question'||submittedFor===state.index)return;
 // Read the latest value directly from the input: mobile Safari may not have
 // committed its last input event before the first Submit tap.
 const field=document.getElementById('textanswer');
 const answer=(state.question?.type==='choice'?selected:(field?.value??selected)).trim();
 if(!answer)return alert('Enter or select an answer');
 if(state.question.type!=='choice'&&!/^[a-zA-Z ]{1,75}$/.test(answer))
  return alert('Letters and spaces only, maximum 75 characters');
 submittingAnswer=true;
 const submitButton=document.querySelector('.participant-entry .submit-button');
 if(submitButton){submitButton.disabled=true;submitButton.textContent='Submitting…'}
 try{
  await api({op:'answer',id:playerId,token:playerToken,answer});
  selected=answer;submittedFor=state.index;
  if(field)field.blur();
  render();
 }catch(e){
  if(e.message==='Already answered'){submittedFor=state.index;render()}
  else{if(submitButton){submitButton.disabled=false;submitButton.textContent='Submit answer'}alert(e.message)}
 }finally{submittingAnswer=false}
}

// Fit actual rendered text after viewport grid sizing, without changing the
// Host or Big Screen question font. Important for long clues on iPad landscape.
function fitParticipantText(){
 if(view!=='player'||!state||!['question','results'].includes(state.phase))return;
 const panel=document.querySelector('.player-game .participant-preview');
 if(!panel)return;
 const reduce=(node,limit,minSize)=>{
  if(!node||!limit||limit<1)return;
  node.style.removeProperty('font-size');
  let px=parseFloat(window.getComputedStyle(node).fontSize)||16;
  let count=0;
  while(px>minSize&&count++<40&&
        (node.scrollHeight>limit+2||node.scrollWidth>node.clientWidth+2)){
   px=Math.max(minSize,px-.6);
   node.style.setProperty('font-size',px.toFixed(1)+'px','important');
  }
 };
 const question=panel.querySelector('.question-copy');
 const shape=panel.querySelector('.ppt-prompt');
 if(question&&shape)reduce(question,Math.max(20,shape.clientHeight-9),9);
 panel.querySelectorAll('.ppt-hex').forEach(n=>reduce(n,n.clientHeight,9));
 // A single compound word must remain on one line inside its hexagon.
 // Measure the actual rendered label and reduce it rather than splitting
 // trailing letters across lines on narrow portrait phones.
 panel.querySelectorAll('.participant-option-label').forEach(label=>{
  const single=!/\s/.test(label.textContent||'');
  label.classList.toggle('one-word',single);
  const box=label.closest('.ppt-hex');
  const maximum=Math.max(12,(box?.clientHeight||label.clientHeight)-4);
  reduce(label,maximum,7.5);
  if(single&&label.clientWidth>0&&label.scrollWidth>label.clientWidth){
   const scale=Math.max(.62,Math.min(1,(label.clientWidth-2)/label.scrollWidth));
   label.style.transform='scaleX('+scale.toFixed(3)+')';
   label.style.transformOrigin='center';
  }else{
   label.style.transform='';
  }
 });
 panel.querySelectorAll('.participant-answer,.participant-outcome,.participant-fast').forEach(n=>reduce(n,n.clientHeight,9));
 panel.querySelectorAll('.participant-score').forEach(n=>{
  const name=n.querySelector('span');if(name)reduce(name,Math.max(20,n.clientHeight-5),9)
 });
}
window.addEventListener('resize',()=>{if(view==='player')requestAnimationFrame(()=>{fitParticipantText();syncParticipantGuides()})});
if(window.visualViewport)window.visualViewport.addEventListener('resize',()=>{if(view==='player')requestAnimationFrame(()=>{fitParticipantText();syncParticipantGuides()})});
function syncParticipantGuides(){
 document.querySelectorAll('.quiz-full-bleed-guide').forEach(n=>n.remove());
 if(view!=='player'||!state||!['question','results'].includes(state.phase))return;
 const stage=document.querySelector('.participant-preview');if(!stage)return;
 const lanes=[[stage.querySelector('.participant-question-track'),[stage.querySelector('.participant-question-track .ppt-prompt')]],
 [stage.querySelector('.participant-options'),Array.from(stage.querySelectorAll('.participant-options>.ppt-hex'))]];
 for(const [lane,shapes] of lanes){
  if(!lane||!shapes.length)continue;
  const lr=lane.getBoundingClientRect();if(lr.height<1)continue;
  const y=lr.top+lr.height/2;
  const boxes=shapes.filter(Boolean).map(n=>n.getBoundingClientRect()).sort((a,b)=>a.left-b.left);
  let start=0;
  for(const box of [...boxes,{left:window.innerWidth,right:window.innerWidth}]){
   const end=Math.min(window.innerWidth,Math.max(0,box.left));
   if(end-start>1){const line=document.createElement('div');line.className='quiz-full-bleed-guide';line.style.cssText='top:'+y+'px;left:'+start+'px;width:'+(end-start)+'px';document.body.appendChild(line)}
   start=Math.max(start,Math.min(window.innerWidth,box.right));
  }
 }
}
window.addEventListener('scroll',()=>{if(view==='player')requestAnimationFrame(syncParticipantGuides)},{passive:true});
function render(){if(!state&&!hostPreviewMode)return;
const presentationControls=view==='screen'&&!document.fullscreenElement
?'<div class="slideshow-toolbar"><button class="launch-slideshow" onclick="launchSlideshow()">⛶ Full Screen Slideshow</button>'+(!soundEnabled?'<button class="screen-audio-btn" onclick="enableSound()">🔊 Enable Sound</button>':'')+'<div id="slideshow-help" class="slideshow-help hidden">This browser does not allow websites to hide its tabs or address bar. Use a browser with fullscreen support or open this screen from your TV browser in fullscreen mode.</div></div>'
:'';
const otherSound=view==='screen'&&!soundEnabled?'<button class="screen-enable-audio" onclick="enableSound()">🔊 Enable finale sound</button>':view==='player'||view==='screen'?'':soundControl();
document.querySelectorAll('.quiz-full-bleed-guide').forEach(n=>n.remove());el.innerHTML='<div class="view-'+view+'">'+(hostPreviewMode?'':presentationControls+otherSound)+(hostPreviewMode?hostFontPreview():view==='host'?hostView():view==='screen'?screen():playerView())+'</div>';
document.querySelectorAll('.ppt-prompt,.title-hex,.host-glow-shape').forEach(node=>{if(!node.querySelector('.travel-outline'))node.insertAdjacentHTML('beforeend',animatedBorder())});fitQuestionText();fitHostQuestion();startGlow();tick();if(view==='player')requestAnimationFrame(()=>{fitParticipantText();syncParticipantGuides()})}
function tick(){if(!state?.endsAt||state.phase!=='question')return;if(Date.now()>=state.endsAt){stopSuspense();return;}const secs=Math.max(0,Math.ceil((state.endsAt-Date.now())/1000)),n=document.getElementById('clock');if(n)n.textContent=Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0');const key=state.index+':'+secs;if(secs>=1&&key!==lastTickKey){lastTickKey=key;if(secs<=10)playTick(secs)}}
function applyQuizState(incoming){
 const old=state;
 state=incoming;
 if(old?.phase==='question'&&state.phase!=='question')stopSuspense();
 if(old?.phase==='question'&&state.phase==='results'&&lastResult!==state.index){lastResult=state.index;playCorrectAnswer()}
 if(old&&old.phase!=='finished'&&state.phase==='finished')playVictoryOnce();
 if(old?.index!==state.index){selected='';submittedFor=-1;submittingAnswer=false}
 const preserveTyping=view==='player'&&old?.phase==='question'&&state.phase==='question'&&old.index===state.index&&(!!document.getElementById('textanswer')||submittingAnswer);
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
