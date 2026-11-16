import {describe,it,expect} from 'vitest';
import {filledArrowPath} from './filledArrow';

describe('filled arrow outline', () => {
  it('rounds only the bends with concentric arcs and keeps the head sharp', () => {
    const path=filledArrowPath({x:274,y:0},{x:0,y:100},{lineType:'step',stepRadius:16});
    expect(path.match(/ A /g)).toHaveLength(4);
    expect(path).toContain('A 11,11');
    expect(path).toContain('A 21,21');
    expect(path).toContain('L 0,100');
    for (const bendAxis of ['horizontal','vertical']) for (const x of [-200,.01,200]) for (const y of [-100,.01,100]) {
      expect(filledArrowPath({x:0,y:0},{x,y},{lineType:'step',bendAxis,stepRadius:200})).not.toMatch(/NaN|Infinity/);
    }
  });
  it('matches the existing blue block arrow geometry for a straight route', () => {
    expect(filledArrowPath({x:0,y:0},{x:100,y:0})).toBe(
      'M 0,5 L 86,5 L 86,11 L 100,0 L 86,-11 L 86,-5 L 0,-5 Z');
  });
  it('retains the exact tip and generates one closed outline across both bends', () => {
    const path=filledArrowPath({x:274,y:0},{x:0,y:40},{lineType:'step'});
    expect(path).toContain('L 0,40');
    expect(path).toContain('L 132,-5');
    expect(path).toContain('L 132,35');
    expect(path.endsWith(' Z')).toBe(true);
    expect(path.match(/M/g)).toHaveLength(1);
  });
  it('supports vertical routing and an adjustable bend', () => {
    const a={x:0,y:0}, b={x:100,y:100};
    expect(filledArrowPath(a,b,{lineType:'step',bendAxis:'vertical',bendPosition:.3})).toContain('L -5,35');
    expect(filledArrowPath(a,b,{lineType:'step',bendPosition:.3})).toContain('L 25,5');
  });
  it('handles zero length, reversed and nearly aligned endpoints without invalid coordinates', () => {
    expect(filledArrowPath({x:4,y:4},{x:4,y:4})).toBe('');
    for (const x of [-200,0,.01,200]) for (const y of [-100,0,.01,100]) {
      const d=filledArrowPath({x:0,y:0},{x,y},{lineType:'step'});
      expect(d).not.toMatch(/NaN|Infinity/);
    }
  });
});
