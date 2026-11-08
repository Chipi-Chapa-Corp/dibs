import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuzzerInput,sendBuzz} from '../src/buzzer';

test('a pointer press sends immediately and its later click does not toggle readiness or buzz twice',()=>{
  const input=createBuzzerInput();let presses=0;
  input.pointerDown(()=>presses++);assert.equal(presses,1);
  // State may have changed between pointer-down and click.
  input.click(1,()=>presses++);assert.equal(presses,1);
  input.pointerDown(()=>presses++);input.click(2,()=>presses++);assert.equal(presses,2);
});

test('click-only and keyboard activations work, including after cancelled gestures',()=>{
  const input=createBuzzerInput();let presses=0;const press=()=>presses++;
  input.click(1,press);input.click(0,press);assert.equal(presses,2);
  input.pointerDown(press);input.cancel();input.click(1,press);assert.equal(presses,4);
  input.pointerDown(press);input.click(0,press);assert.equal(presses,6);
});

test('a failed or unavailable vibration cannot prevent the buzz command',()=>{
  for(const feedback of [{},{vibrate:()=>false},{vibrate:()=>{throw Error('Unavailable');}}]){
    const actions:string[]=[];
    assert.doesNotThrow(()=>sendBuzz(async action=>{actions.push(action);return true;},feedback));
    assert.deepEqual(actions,['buzz']);
  }
});
