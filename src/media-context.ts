import {createContext} from 'react';
import type {GameView,PresenterStatus} from '../shared/model';

export const PresenterFeedback=createContext<{connected:boolean;presenters:PresenterStatus[]}>({connected:false,presenters:[]});
export const HostClueMedia=createContext<{g:GameView;clueOnly?:boolean;command:(action:string,data?:Record<string,unknown>)=>Promise<boolean>}|null>(null);
