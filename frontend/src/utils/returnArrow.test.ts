import {describe,it,expect} from 'vitest';
import {returnArrowPath} from './arrowGeometry';

describe('native return arrow directions',()=>{
  it('keeps the existing downward path',()=>{
    expect(returnArrowPath({x:975,y:0},{x:0,y:38},{x:487,y:71}))
      .toBe('M 975,0 L 975,55 Q 975,71 959,71 L 16,71 Q 0,71 0,55 L 0,38');
  });
  it('has straight vertical rails and exact endpoint alignment',()=>{
    const right=returnArrowPath({x:600,y:170},{x:600,y:280},{x:650,y:225},'right');
    expect(right).toBe('M 600,170 L 634,170 Q 650,170 650,186 L 650,264 Q 650,280 634,280 L 600,280');
    const left=returnArrowPath({x:480,y:280},{x:480,y:170},{x:440,y:225},'left');
    expect(left).toContain('L 440,186');
    expect(left.endsWith('L 480,170')).toBe(true);
  });
});
