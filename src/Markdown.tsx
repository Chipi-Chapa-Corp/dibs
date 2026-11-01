import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize,{defaultSchema} from 'rehype-sanitize';
const schema={...defaultSchema,tagNames:[...(defaultSchema.tagNames||[]),'video','audio','source'],attributes:{...defaultSchema.attributes,video:['src','controls','loop','muted','autoPlay','playsInline','poster','preload'],audio:['src','controls','loop','muted','preload'],source:['src','type'],img:['src','alt','title','width','height']}};
function mediaURL(url:string){try{const u=new URL(url,location.origin);return['http:','https:'].includes(u.protocol)?u:null;}catch{return null;}}
export default function RichText({text,className=''}:{text:string;className?:string}){
 return <div className={`rich-text ${className}`}><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw,[rehypeSanitize,schema]]} components={{img:({node,...props})=><img {...props} loading="lazy"/>,a:({node,href,children,...props})=>{const u=mediaURL(href||'');const path=u?.pathname||'';if(/\.(mp4|webm|ogv)$/i.test(path))return <video controls playsInline preload="metadata" src={href}/>;if(/\.(mp3|wav|ogg|m4a)$/i.test(path))return <audio controls preload="metadata" src={href}/>;if(u&&['www.youtube.com','youtube.com','youtu.be'].includes(u.hostname)){const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v')||u.pathname.split('/').pop();if(id&&/^[a-zA-Z0-9_-]{11}$/.test(id))return <iframe title={typeof children==='string'?children:'Video'} src={`https://www.youtube-nocookie.com/embed/${id}`} allow="fullscreen; picture-in-picture" allowFullScreen/>;}return <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>;}}}>{text}</Markdown></div>;
}
