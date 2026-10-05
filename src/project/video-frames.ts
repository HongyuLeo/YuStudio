export type VideoFrameCache={baseSrc:string;timestamps:number[];width:number;height:number;bytes:number};
export type VideoFrameCaches=Record<string,VideoFrameCache>;
export function cachedFrameAt(timestamps:number[],time:number) {
  let low=0,high=timestamps.length;
  while(low<high){const middle=(low+high)>>>1;if(timestamps[middle]<=time+1e-7)low=middle+1;else high=middle;}
  return Math.max(0,low-1);
}
export const frameFilename=(index:number)=>`${String(index).padStart(8,'0')}.png`;
