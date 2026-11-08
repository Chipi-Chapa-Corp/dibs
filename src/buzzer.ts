/** Keep pointer-down latency while accepting browsers' click-only activation. */
export function createBuzzerInput(){
  let handledPointer=false;
  return{
    pointerDown(press:()=>void){handledPointer=true;press();},
    cancel(){handledPointer=false;},
    click(detail:number,press:()=>void){
      const handled=handledPointer;handledPointer=false;
      if(detail===0||!handled)press();
    },
  };
}

export function sendBuzz(command:(action:string)=>Promise<boolean>,feedback:Partial<Pick<Navigator,'vibrate'>>=navigator){
  void command('buzz');
  // Optional feedback must never stop a gameplay command.
  try{feedback.vibrate?.(25);}catch{}
}
