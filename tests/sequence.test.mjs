import assert from 'node:assert/strict';
import {RasenganSequence} from '../src/sequence.js';
import {isFingerGun} from '../src/gestures.js';
const seq=new RasenganSequence();
const open={open:true,gun:false}, gun={open:false,gun:true};
function tick(hand,seconds,ended=false){const events=[];for(let i=0;i<Math.round(seconds/.01);i++){const e=seq.step(hand,.01,ended);if(e)events.push(e);}return events;}
assert.equal(seq.step(open,.01),'charge');
tick(open,1);assert.equal(seq.phase,'charging');assert.ok(seq.charge<1);
tick(open,.51);assert.equal(seq.phase,'ready');
tick(null,.1);assert.equal(seq.phase,'ready');
assert.deepEqual(tick(gun,.2),['launch']);
assert.deepEqual(tick(null,.45),['impact']);assert.equal(seq.phase,'blast');
assert.equal(seq.step(gun,.01,true),'blast-end');
assert.deepEqual(tick(gun,3),[]);assert.equal(seq.phase,'cooldown');
assert.deepEqual(tick(open,.25),['charge']);assert.equal(seq.phase,'charging');
tick(null,.25);assert.equal(seq.phase,'idle');
assert.deepEqual(tick(gun,1),[]);assert.equal(seq.phase,'idle');
// Construct joints with two straight fingers facing the camera and two folded fingers.
const pts=Array.from({length:21},()=>({x:0,y:0,z:0}));
for(const [base,x] of [[5,-.015],[9,.005],[13,.025],[17,.045]]){
 const folded=base>=13;
 pts[base]={x,y:0,z:0};
 pts[base+1]={x,y:0,z:-.025};
 pts[base+2]={x,y:folded?.018:0,z:folded?-.025:-.045};
 pts[base+3]={x,y:folded?.018:0,z:folded?-.008:-.065};
}
assert.equal(isFingerGun(pts),true);
const away=pts.map(p=>({...p,z:-p.z}));assert.equal(isFingerGun(away),false);
const side=pts.map(p=>({x:p.x,y:p.z,z:p.y}));assert.equal(isFingerGun(side),false);
assert.equal(isFingerGun(null),false);
console.log('PASS: 1.5s charge, transition grace, one launch, impact, missing hand during flight, rearming, charge cancellation, 3D forward/side/back gesture checks.');

// Closing the palm cancels a ready orb, while hand order never changes jutsu.
seq.reset(); tick(open,1.6); assert.equal(seq.phase,'ready');
assert.equal(seq.step({open:false,closed:true,gun:false},.01),'dismiss');
assert.equal(seq.phase,'idle');
const {assignHandRoles}=await import('../src/handRoles.js');
const left={label:'Left'},right={label:'Right'};
assert.equal(assignHandRoles([left,right]).rasengan,right);
assert.equal(assignHandRoles([right,left]).chidori,left);
assert.equal(assignHandRoles([right]).chidori,null);
assert.equal(assignHandRoles([left,right],true).rasengan,left);
console.log('PASS: closed-palm dismissal and stable two-hand assignments.');
