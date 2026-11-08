import {createContext,useContext} from 'react';
import Markdown from 'react-markdown';
import type {Components} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize,{defaultSchema} from 'rehype-sanitize';
import {RevealImage} from './RevealImage';
import {presentationMedia} from './presentation-media';
import {ReadOnlyPresenter} from './presenter-context';
import {HostClueMedia} from './media-context';
import {HostAudioControls} from './HostAudioControls';
import {PresenterAudio} from './PresenterAudio';
const schema={...defaultSchema,tagNames:[...(defaultSchema.tagNames||[]),'video','audio','source'],attributes:{...defaultSchema.attributes,video:['src','controls','loop','muted','autoPlay','playsInline','poster','preload'],audio:['src','controls','loop','muted','preload'],source:['src','type'],img:['src','alt','title','width','height']}};
function mediaURL(url:string){try{const u=new URL(url,location.origin);return['http:','https:'].includes(u.protocol)?u:null;}catch{return null;}}
const ImageRevealContext=createContext<{slowReveal:boolean;revealAt?:number;revealPausedAt?:number}>({slowReveal:false});
const components:Components={
 p:({node,children})=>{
  const media=node?.children.some(n=>n.type==='element'&&(n.tagName==='audio'||n.tagName==='a'&&/\.(mp3|wav|ogg|m4a)(?:[?#]|$)/i.test(String(n.properties.href||''))&&!String(n.properties.href).includes('/wiki/File:')));
  return media?<div className="media-paragraph">{children}</div>:<p>{children}</p>;
 },
 img:function MarkdownImage({node,...props}){
  const {slowReveal,...timing}=useContext(ImageRevealContext);
  return slowReveal?<RevealImage key={String(props.src)} {...props} {...timing}/>:<img {...props} loading="lazy"/>;
 },
 video:({node,...props})=>{const readOnly=useContext(ReadOnlyPresenter);return <video {...props} controls={!readOnly&&props.controls} autoPlay={!readOnly&&props.autoPlay} muted={readOnly||props.muted} tabIndex={readOnly?-1:undefined} playsInline/>;},
 audio:({node,...props})=>{const readOnly=useContext(ReadOnlyPresenter),host=useContext(HostClueMedia);const source=node?.children.find(n=>n.type==='element'&&n.tagName==='source');const src=props.src||(source?.type==='element'?String(source.properties.src||''):'');return readOnly?<PresenterAudio key={src} {...props} src={src}/>:host?<HostAudioControls src={src}/>:<audio {...props}/>;},
 a:({node,href,children,...props})=>{const readOnly=useContext(ReadOnlyPresenter),host=useContext(HostClueMedia);const u=mediaURL(href||'');const path=u?.pathname||'';if(/\.(mp4|webm|ogv)$/i.test(path))return <video controls={!readOnly} muted={readOnly} playsInline preload="metadata" src={href}/>;if(/\.(mp3|wav|ogg|m4a)$/i.test(path)&&!path.includes('/wiki/File:'))return readOnly?<PresenterAudio key={href} src={href}/>:host?<HostAudioControls src={href||''}/>:<audio controls preload="metadata" src={href}/>;if(u&&['www.youtube.com','youtube.com','youtu.be'].includes(u.hostname)){const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.split('/').pop();if(id&&/^[a-zA-Z0-9_-]{11}$/.test(id))return <iframe title={typeof children==='string'?children:'Video'} src={`https://www.youtube-nocookie.com/embed/${id}${readOnly?'?enablejsapi=1&controls=0&disablekb=1':''}`} tabIndex={readOnly?-1:undefined} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen={!readOnly}/>;}return readOnly?<span>{children}</span>:<a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>;}
};
export default function RichText({text,className='',slowReveal=false,revealAt,revealPausedAt,presentation=false,imagesOnly=false}:{text:string;className?:string;slowReveal?:boolean;revealAt?:number;revealPausedAt?:number;presentation?:boolean;imagesOnly?:boolean}){
 return <ImageRevealContext.Provider value={{slowReveal,revealAt,revealPausedAt}}><div className={`rich-text ${className} ${presentation?'presentation-clue':''}`}><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw,[rehypeSanitize,schema],[presentationMedia,{enabled:presentation||imagesOnly,imagesOnly}]]} components={components}>{text}</Markdown></div></ImageRevealContext.Provider>;
}
