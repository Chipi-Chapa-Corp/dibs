interface AudioGraph { context:AudioContext; source:MediaElementAudioSourceNode; analyser:AnalyserNode; connected:boolean }
let context:AudioContext|null=null,graphs=new WeakMap<HTMLMediaElement,AudioGraph>();

export function audioAnalysis(media:HTMLMediaElement):AudioGraph|null{
  const existing=graphs.get(media);
  if(existing){
    if(!existing.connected){existing.source.connect(existing.analyser);existing.analyser.connect(existing.context.destination);existing.connected=true;}
    return existing;
  }
  const src=media.currentSrc||media.src||media.querySelector('source')?.src;
  if(!src)return null;
  // Analyser routing must not silence a remote file that does not allow CORS.
  try{if(new URL(src,location.href).origin!==location.origin&&!media.crossOrigin)return null;}catch{return null;}
  try{
    context??=new AudioContext();
    const analyser=context.createAnalyser();analyser.fftSize=1024;
    const source=context.createMediaElementSource(media);
    source.connect(analyser);analyser.connect(context.destination);
    const graph={context,source,analyser,connected:true};graphs.set(media,graph);return graph;
  }catch{return null;}
}
export function resumeAudioAnalysis(media:HTMLMediaElement){
  const graph=audioAnalysis(media);
  if(graph&&graph.context.state==='suspended')void graph.context.resume().catch(()=>{});
}
export function releaseAudioAnalysis(media:HTMLMediaElement){
  const graph=graphs.get(media);
  if(graph){graph.source.disconnect();graph.analyser.disconnect();graph.connected=false;}
}
export function closeAudioAnalysis(){
  if(context)void context.close().catch(()=>{});
  context=null;graphs=new WeakMap();
}
