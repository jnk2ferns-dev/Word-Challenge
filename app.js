let view=new URLSearchParams(location.search).get('view')||'host';
let state=null,playerId=localStorage.getItem('qm_player')||'',playerToken=localStorage.getItem('qm_token')||'',hostKey=sessionStorage.getItem('qm_host')||'',selected='',submittedFor=-1,lastResult=-1;
const el=document.getElementById('app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setView(v){view=v;history.replaceState(null,'','?view='+v);render()}
async function api(b){const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');return j}
async function host(op,extra={}){unlockAudio();try{await api({op,hostKey,...extra})}catch(e){alert(e.message);if(e.message==='Incorrect host key'){sessionStorage.removeItem('qm_host');hostKey='';render()}}}
let audioContext=null,soundEnabled=false,lastTickKey='',suspenseTimer=null,correctSound=null,victorySound=null,victoryPlayedFor=null;
fetch('/correct-answer.b64').then(r=>r.ok?r.text():Promise.reject(Error('Missing sound file'))).then(b64=>{correctSound=new Audio('data:audio/mpeg;base64,'+b64.trim());correctSound.preload='auto';correctSound.volume=.9}).catch(e=>console.warn('Unable to load uploaded audio:',e));
function unlockAudio(){try{audioContext=audioContext||new(window.AudioContext||window.webkitAudioContext)();const p=audioContext.resume();if(p?.catch)p.catch(()=>{});soundEnabled=true;loadVictoryAudio();return true}catch(e){return false}}
function enableSound(){if(!unlockAudio()){alert('Sound unavailable on this device');return}playCorrectAnswer();render();if(state?.phase==='question')startSuspense()}
function note(freq,t,dur,gain=.035,type='sine'){if(!soundEnabled||!audioContext||audioContext.state!=='running')return;const c=audioContext,o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.015);g.gain.setValueAtTime(gain,t+Math.max(.03,dur-.06));g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g).connect(c.destination);o.start(t);o.stop(t+dur+.01)}
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
 if(!soundEnabled||!state||state.phase!=='finished')return;
 const key=state.pin+':'+state.total;
 if(victoryPlayedFor===key)return;
 victoryPlayedFor=key;
 stopSuspense();
 if(correctSound){correctSound.pause();correctSound.currentTime=0}
 try{const audio=await loadVictoryAudio();if(!audio)return;audio.loop=false;audio.pause();audio.currentTime=0;await audio.play()}catch(e){console.warn('Victory sound blocked on this device',e)}
}
function playCorrectAnswer(){if(!soundEnabled)return;try{if(correctSound){correctSound.pause();correctSound.currentTime=0;correctSound.play().catch(e=>console.warn('Correct answer audio blocked:',e))}else if(audioContext){const t=audioContext.currentTime;[523,659,784,1047].forEach((f,i)=>note(f,t+i*.13,.24,.08))}}catch(e){console.warn(e)}}
function playTick(sec){if(!soundEnabled||!audioContext)return;note(sec<=3?940:690,audioContext.currentTime+.01,sec===1?.2:.095,sec<=3?.08:.045)}
function suspensePulse(){if(state?.phase!=='question'||!state.endsAt||Date.now()>=state.endsAt){stopSuspense();return}const remain=Math.ceil((state.endsAt-Date.now())/1000);if(remain<=10)return;if(!soundEnabled||!audioContext)return;const t=audioContext.currentTime+.01;note(164.8,t,.32,.012,'sine');note(196,t+.28,.25,.012,'triangle');note(220,t+.59,.22,.01,'sine')}
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
function stopSuspense(){
 if(suspenseTimer!==null){clearInterval(suspenseTimer);suspenseTimer=null}
 if(suspenseMix&&audioContext){const t=audioContext.currentTime;try{suspenseMix.gain.cancelScheduledValues(t);suspenseMix.gain.setValueAtTime(suspenseMix.gain.value,t);suspenseMix.gain.linearRampToValueAtTime(0,t+.13)}catch{}}
 for(const src of suspenseSources){try{src.stop((audioContext?.currentTime||0)+.15)}catch{}}suspenseSources=[];
 suspenseMix=null;suspenseSequence=null;
}
async function startSuspense(){
 if(!soundEnabled||state?.phase!=='question'||Date.now()>=state.endsAt)return;
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
function animatedBorder(){return '<svg class="travel-outline" viewBox="0 0 1000 240" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><path id="travelPath" d="M100 2 L900 2 L998 120 L900 238 L100 238 L2 120 Z"/></defs><circle r="6" fill="#fffce9"><animateMotion dur="5s" repeatCount="indefinite"><mpath href="#travelPath"/></animateMotion></circle></svg>'}
function questionFontSize(prompt){const len=String(prompt||'').length;return len>185?19:len>145?21:len>110?23:len>82?25:29}
function fitQuestionText(){document.querySelectorAll('.question-copy').forEach(n=>{const holder=n.closest('.ppt-prompt');if(!holder)return;let size=questionFontSize(n.textContent),maxHeight=holder.clientHeight-18;n.style.fontSize=size+'px';while(size>17&&n.scrollHeight>maxHeight){size--;n.style.fontSize=size+'px'}})}
function confetti(){let pieces='';const colors=['#f1792c','#fff','#ffd54b','#086b59','#ed3434','#1878ff'];for(let i=0;i<76;i++){const x=(i*37.37)%100,delay=((i*13)%35)/10,duration=3+((i*7)%24)/10;pieces+='<i style="--x:'+x+'%;--delay:'+delay+'s;--speed:'+duration+'s;--c:'+colors[i%colors.length]+';--spin:'+(i%2?'720deg':'-540deg')+'"></i>'}return '<div class="confetti" aria-hidden="true">'+pieces+'</div>'}
function challengeLabel(r){return r===1?'What Word Comes After':r===2?'What Word Comes Before':r===3?'What Word Ends with &quot;Try&quot;':'2 Meanings 1 Word'}
function scores(){return '<div class="ppt-scores">'+['A','B'].map(t=>'<div class="ppt-score team-'+t.toLowerCase()+' '+(state.results?.roundWinner===t?'highlight':'')+'"><span>TEAM-'+t+'</span><strong>'+state.scores[t]+'</strong><small>POINTS'+(state.results?' · +'+state.results.round[t]+' this question':'')+'</small>'+(state.results?.roundWinner===t?'<em>WINNER</em>':'')+'</div>').join('')+'</div>'}
function banner(round){const label=round===3?'What Word Ends with &quot;Try&quot;':challengeLabel(round);return '<div class="ppt-ribbon"><svg class="ribbon-art" viewBox="0 0 1100 130" preserveAspectRatio="none" aria-hidden="true"><path d="M14 32 L283 20 L284 104 L14 121 L149 77 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M1086 32 L817 20 L816 104 L1086 121 L951 77 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M282 10 L818 10 L818 106 L282 106 Z" fill="#EE752D" stroke="white" stroke-width="2.5"/><path d="M306 106 L415 122 L415 106 M685 106 L685 122 L794 106" fill="none" stroke="white" stroke-width="2"/></svg><div class="ribbon-caption"><span>The Quiz Master Show:</span><span>Word Challenge: '+label+'</span></div></div>'}
function questionPanel(q){return '<div class="question-track"><div class="ppt-prompt"><span class="question-copy" data-target-size="'+questionFontSize(q.prompt)+'">'+esc(q.prompt)+'</span></div></div>'}
function question(){const q=state.question;return '<div class="ppt-question '+(q.words?.length?'word-mode':'definition-mode')+'">'+banner(q.round)+questionPanel(q)+(q.words?.length?'<div class="ppt-words">'+q.words.map(w=>'<div class="ppt-hex">'+esc(w)+'</div>').join('')+'</div>':'')+'</div>'}
function results(){const r=state.results,q=state.question;return '<div class="ppt-stage '+(q.words?.length?'word-slide':'definition-slide')+' results-stage"><div class="ppt-question '+(q.words?.length?'word-mode':'definition-mode')+'">'+banner(q.round)+questionPanel(q)+(r.completed?.length?'<div class="ppt-words">'+r.completed.map(w=>'<div class="ppt-hex revealed">'+esc(w)+'</div>').join('')+'</div>':'')+'</div><div class="ppt-answer">'+esc(r.correct)+'</div><div class="ppt-outcome">'+(r.roundWinner==='draw'?'ROUND DRAW — EQUAL POINTS':'TEAM '+r.roundWinner+' WINS THIS QUESTION!')+'</div><div class="ppt-fast">⚡ FASTEST CORRECT: '+(r.fast?esc(r.fast.name)+' (TEAM '+r.fast.team+' · '+r.fast.seconds.toFixed(1)+'s)':'No correct answer submitted')+'</div>'+scores()+'</div>'}
function finale(){const a=state.scores.A,b=state.scores.B,w=a===b?'draw':a>b?'A':'B';const winners=w==='draw'?['A','B']:[w];const names=winners.map(t=>'<div class="winner-team"><div class="winner-team-name">TEAM '+t+'</div><div class="winner-member-names">'+(state.players.filter(p=>p.team===t).map(p=>esc(p.name)).join(', ')||'')+'</div></div>').join('');return '<div class="ppt-stage finale-stage">'+confetti()+'<div class="ppt-ribbon"><span>The Quiz Master Show</span><span>Quiz Complete!</span></div><h1 class="ppt-final">'+(w==='draw'?"IT'S A TIE! CONGRATULATIONS TO BOTH TEAMS!":'CONGRATULATIONS TEAM '+w+'!')+'</h1><div class="winning-members">'+names+'</div>'+scores()+'</div>'}
function sectionScreen(){return '<div class="ppt-stage opening-stage"><div class="title-hex"><span>Word Challenge '+state.sectionRound+'</span></div></div>'}
function screen(){if(state.phase==='lobby')return '<div class="ppt-stage opening-stage"><div class="title-hex"><span>Word Challenge 1</span></div><div class="join-pin">GAME PIN: '+state.pin+' · '+state.players.length+' registered</div></div>';if(state.phase==='section')return sectionScreen();if(state.phase==='finished')return finale();if(state.phase==='results')return results();return '<div class="ppt-stage '+(state.question.words?.length?'word-slide':'definition-slide')+'">'+question()+'<div class="ppt-count"><span class="timer" id="clock"></span><span>'+state.answered+' answers received</span></div>'+scores()+'</div>'}
function hostView(){if(!hostKey)return '<div class="panel"><h2>Host login</h2><p>Enter the private host password set in Render.</p><input id="hostkey" type="password" placeholder="Host password"><button onclick="hostKey=document.getElementById(\'hostkey\').value;sessionStorage.setItem(\'qm_host\',hostKey);render()">Open dashboard</button></div>';
let out='<div class="panel"><h2>HOST DASHBOARD</h2><div class="row"><span>Game PIN: <b>'+state.pin+'</b></span><span>Registered: '+state.players.length+' / '+state.capacity+'</span><a class="button secondary" href="/?view=screen" target="_blank">Open big screen ↗</a></div><p>Keep this dashboard private. Use the presentation screen in another browser tab.</p></div>';
if(state.phase==='lobby')out+='<div class="panel"><h2>Assign Teams</h2><div class="players">'+state.players.map(p=>'<div class="player"><b>'+esc(p.name)+'</b><p>'+(p.team?'Team '+p.team:'Unassigned')+'</p><button onclick="host(\'team\',{id:\''+p.id+'\',team:\'A\'})">Team A</button> <button onclick="host(\'team\',{id:\''+p.id+'\',team:\'B\'})">Team B</button></div>').join('')+'</div><p><button onclick="host(\'start\')">Start Word Challenge 1</button></p></div>';
if(state.phase==='section')out+=sectionScreen()+'<div class="center"><button onclick="host(\'next\')">Show Question '+(state.index+1)+' →</button></div>';
if(state.phase==='lobby'||state.phase==='section'||state.phase==='results')out+='<div class="panel"><label>Timer for next question (5–300 seconds)</label><input id="duration" type="number" min="5" max="300" value="'+state.duration+'"><button class="secondary" onclick="host(\'duration\',{seconds:Number(document.getElementById(\'duration\').value)})">Save timer</button></div>';
if(state.phase==='question')out+=screen()+'<div class="center"><button onclick="host(\'reveal\')">Close Answers & Reveal Results</button></div>';
if(state.phase==='results')out+=results()+'<div class="center"><button onclick="host(\'next\')">'+(state.index+1===state.total?'Finish quiz':'Next Question →')+'</button></div>';
if(state.phase==='finished')out+=finale();
return out+'<div class="panel"><button class="secondary" onclick="if(confirm(\'Reset quiz and registered players?\')){host(\'reset\');localStorage.removeItem(\'qm_player\');localStorage.removeItem(\'qm_token\')}">Reset quiz</button></div>'}
function playerView(){
const p=state.players.find(x=>x.id===playerId);
if(!p||!playerToken)return '<div class="player-app"><div class="mobile-card"><p class="eyebrow">THE QUIZ MASTER SHOW</p><h2>Join the game</h2><label for="name">Your name</label><input id="name" maxlength="50" placeholder="Full name"><label for="phone">Mobile number</label><input id="phone" inputmode="tel" placeholder="Use a test number"><label for="pin">Game PIN</label><input id="pin" inputmode="numeric" maxlength="6" placeholder="6-digit PIN"><button class="submit-button" onclick="join()">Join quiz</button><p class="muted">For testing, use a test number rather than your real mobile number.</p></div></div>';
const head='<div class="mobile-head"><div><small>THE QUIZ MASTER SHOW</small><strong>'+esc(p.name)+'</strong></div><span class="team-chip team-chip-'+(p.team||'waiting')+'">'+(p.team?'Team '+p.team:'Unassigned')+'</span></div>';
if(state.phase==='lobby')return '<div class="player-app">'+head+'<div class="mobile-card centered"><h2>Ready to play?</h2><p>'+(p.team?'You are in Team '+p.team:'The host will assign your team')+'</p><p class="muted">Waiting for the host to start.</p></div></div>';
if(state.phase==='section')return '<div class="player-app">'+head+'<div class="mobile-card centered"><p class="eyebrow">NEXT ROUND</p><h2>Word Challenge '+state.sectionRound+'</h2><p class="muted">The host will begin shortly.</p></div></div>';
if(state.phase==='finished')return '<div class="player-app">'+head+'<div class="mobile-card centered"><h2>Quiz complete!</h2><p>'+ (state.scores.A===state.scores.B?'Congratulations to both teams!':'Team '+(state.scores.A>state.scores.B?'A':'B')+' wins!')+'</p><div class="mobile-scores"><span>A: '+state.scores.A+'</span><span>B: '+state.scores.B+'</span></div></div></div>';
if(state.phase==='results'){
const r=state.results;
return '<div class="player-app">'+head+'<div class="mobile-card centered"><p class="eyebrow">QUESTION RESULT</p><h2>'+esc(r.correct)+'</h2>'+(r.completed?.length?'<div class="mobile-reveals">'+r.completed.map(w=>'<span>'+esc(w)+'</span>').join('')+'</div>':'')+'<p class="mobile-winner">'+(r.roundWinner==='draw'?'Round draw':'Team '+r.roundWinner+' wins this question')+'</p><p class="mobile-fast">'+(r.fast?'Fastest correct: '+esc(r.fast.name)+' · Team '+r.fast.team+' · '+r.fast.seconds.toFixed(1)+'s':'No correct responses')+'</p><div class="mobile-scores"><span>Team A: '+state.scores.A+'</span><span>Team B: '+state.scores.B+'</span></div><p class="muted">Waiting for the next question.</p></div></div>'}
const q=state.question,done=submittedFor===state.index;
return '<div class="player-app">'+head+'<div class="mobile-card"><div class="mobile-progress"><span>Challenge '+q.round+' · Question '+(state.index+1)+' of '+state.total+'</span><span class="timer" id="clock"></span></div><h2 class="mobile-question">'+esc(q.prompt)+'</h2>'+(q.words?.length?'<div class="mobile-words">'+q.words.map(w=>'<span>'+esc(w)+'</span>').join('')+'</div>':'')+(done?'<div class="mobile-success">✓ Your answer has been submitted.</div>':q.type==='choice'?'<div class="mobile-choices">'+q.choices.map((c,i)=>'<button class="mobile-choice '+(selected===c?'selected':'')+'" onclick="choose('+i+')">'+esc(c)+'</button>').join('')+'</div><button class="submit-button" onclick="submitAnswer()">Submit answer</button>':'<label class="answer-label" for="textanswer">Your answer</label><input id="textanswer" maxlength="75" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Type your answer" value="'+esc(selected)+'" oninput="this.value=this.value.replace(/[^a-zA-Z ]/g,\'\').slice(0,75);selected=this.value"><p class="input-note">Letters and spaces only, maximum 75 characters.</p><button class="submit-button" onclick="selected=document.getElementById(\'textanswer\').value;submitAnswer()">Submit answer</button>')+'</div></div>'
}
function choose(i){selected=state.question.choices[i];render()}
async function join(){unlockAudio();try{const r=await api({op:'join',name:document.getElementById('name').value,phone:document.getElementById('phone').value,pin:document.getElementById('pin').value});playerId=r.id;playerToken=r.token;localStorage.setItem('qm_player',playerId);localStorage.setItem('qm_token',playerToken);render()}catch(e){alert(e.message)}}
async function submitAnswer(){unlockAudio();if(!selected.trim())return alert('Enter or select an answer');try{await api({op:'answer',id:playerId,token:playerToken,answer:selected});submittedFor=state.index;render()}catch(e){alert(e.message)}}
function render(){if(!state)return;el.innerHTML='<div class="view-'+view+'">'+soundControl()+(view==='host'?hostView():view==='screen'?screen():playerView())+'</div>';document.querySelectorAll('.ppt-prompt,.title-hex').forEach(node=>node.insertAdjacentHTML('beforeend',animatedBorder()));fitQuestionText();tick()}
function tick(){if(!state?.endsAt||state.phase!=='question')return;if(Date.now()>=state.endsAt){stopSuspense();return;}const secs=Math.max(0,Math.ceil((state.endsAt-Date.now())/1000)),n=document.getElementById('clock');if(n)n.textContent=Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0');const key=state.index+':'+secs;if(secs>=1&&key!==lastTickKey){lastTickKey=key;if(secs<=10)playTick(secs)}}
const connection=new EventSource('/events');connection.onerror=()=>{if(!state)el.innerHTML='<div class="panel center"><h2>Reconnecting to quiz...</h2><p>Check the internet connection or refresh the page.</p></div>'};connection.onmessage=e=>{const old=state;state=JSON.parse(e.data);if(old?.phase==='question'&&state.phase!=='question')stopSuspense();if(old?.phase==='question'&&state.phase==='results'&&lastResult!==state.index){lastResult=state.index;playCorrectAnswer()}if(old&&old.phase!=='finished'&&state.phase==='finished'){playVictoryOnce()}if(old?.index!==state.index){selected='';submittedFor=-1}const preserveTyping=view==='player'&&old?.phase==='question'&&state.phase==='question'&&old.index===state.index&&document.activeElement?.id==='textanswer';if(!preserveTyping)render();else tick();if(state.phase==='question')startSuspense()};
setInterval(tick,250);
