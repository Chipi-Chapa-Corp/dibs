import test from 'node:test';
import assert from 'node:assert/strict';
import type {Root,Element} from 'hast';
import {presentationMedia} from '../src/presentation-media';

test('presentation puts mixed Markdown text before images without losing formatting or dimensions',()=>{
  const image:Element={type:'element',tagName:'img',properties:{src:'/picture.jpg',alt:'Picture',width:600,height:400},children:[]};
  const text:Element={type:'element',tagName:'strong',properties:{},children:[{type:'text',value:'Which colour?'}]};
  const root:Root={type:'root',children:[{type:'element',tagName:'p',properties:{},children:[image,{type:'text',value:' '},text]}]};
  presentationMedia({enabled:true})(root);
  const [clue,media]=root.children as Element[];
  assert.deepEqual(clue.children,[{type:'element',tagName:'p',properties:{},children:[{type:'text',value:' '},text]}]);
  assert.deepEqual((media.children[0] as Element).children,[image]);
});

test('image overlays include every clue image and exclude clue text, video and empty wrappers',()=>{
  const image:Element={type:'element',tagName:'img',properties:{src:'/one.jpg'},children:[]};
  const second:Element={...image,properties:{src:'/two.jpg'}};
  const root:Root={type:'root',children:[{type:'element',tagName:'p',properties:{},children:[image]},
    {type:'element',tagName:'p',properties:{},children:[{type:'text',value:'Question'},second]},
    {type:'element',tagName:'video',properties:{src:'/clip.mp4'},children:[]}]};
  presentationMedia({enabled:true,imagesOnly:true})(root);
  assert.deepEqual(root.children,[image,second]);
});
