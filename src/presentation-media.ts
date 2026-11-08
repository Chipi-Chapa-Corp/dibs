import type {Root,RootContent,ElementContent,Element} from 'hast';

/** Lift media out of Markdown paragraphs so it can use the space below the clue. */
export function presentationMedia({enabled=false,imagesOnly=false}:{enabled?:boolean;imagesOnly?:boolean}={}){
  return(tree:Root)=>{
    if(!enabled)return;
    const media:ElementContent[]=[];
    const collect=(nodes:RootContent[]):ElementContent[]=>nodes.flatMap<ElementContent>(node=>{
      if(node.type==='doctype')return[];
      if(node.type!=='element')return[node];
      const href=String(node.properties.href||'');
      if(node.tagName==='img'||!imagesOnly&&(['video','audio'].includes(node.tagName)||node.tagName==='a'&&(/\.(mp4|webm|ogv|mp3|wav|ogg|m4a)(?:[?#]|$)/i.test(href)||/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(href)))){
        media.push(node);return[];
      }
      const children=collect(node.children);
      if(node.children.length&&!children.some(n=>n.type!=='text'||n.value.trim()))return[];
      return[{...node,children}];
    });
    const text=collect(tree.children);
    const group=(className:string,children:ElementContent[]):Element=>({type:'element',tagName:'div',properties:{className:[className]},children});
    tree.children=imagesOnly?media:[group('presenter-clue-text',text),group('presenter-clue-media',media.map(node=>group('presenter-media-item',[node])))];
  };
}
