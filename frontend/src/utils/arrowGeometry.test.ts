import { describe, expect, it } from 'vitest';
import { markerInset, trimArrowPath, roundedJunctionPath } from './arrowGeometry';
import { findSnapTarget } from './snapToShape';
import type { BoardElement } from '@/types/board';
describe('rounded junction', () => {
  it('replaces a crossing with tangent branches and preserves four ports', () => {
    expect(roundedJunctionPath(40,24,6)).toBe('M 20,0 L 20,24 M 20,6 Q 20,12 14,12 L 0,12 M 20,6 Q 20,12 26,12 L 40,12');
    expect(roundedJunctionPath(40,24,6,'up')).toContain('M 20,24 L 20,0 M 20,18 Q 20,12 14,12 L 0,12');
    expect(roundedJunctionPath(40,24,6,'right')).toContain('M 0,12 L 40,12');
    expect(roundedJunctionPath(40,24,6,'left')).toContain('M 40,12 L 0,12');
  });
  it('clamps the radius on resize and permits sharp zero-radius junctions', () => {
    expect(roundedJunctionPath(40,24,999)).toBe(roundedJunctionPath(40,24,12));
    expect(roundedJunctionPath(40,24,-1)).toBe(roundedJunctionPath(40,24,0));
    expect(roundedJunctionPath(0,0,8)).not.toContain('NaN');
  });
  it('snaps connectors to actual ports instead of arbitrary bounding-box edges', () => {
    const el: BoardElement = {id:'junction',type:'rectangle',x:100,y:50,width:40,height:24,visible:true,
      z_index:0,locked:false,rotation:0,metadata:{shape:'rounded-junction'},style:{borderRadius:6}};
    expect(findSnapTarget({x:101,y:59},[el],new Set())?.point).toEqual({x:100,y:62});
    expect(findSnapTarget({x:118,y:49},[el],new Set())?.point).toEqual({x:120,y:50});
  });
});
describe('marker-dependent shaft geometry', () => {
  it('leaves unmarked and blunt endpoints unchanged', () => {
    for(const marker of ['none','bar','dot','diamond']) expect(markerInset(marker,3)).toBe(0);
    expect(trimArrowPath('M 0,0 L 100,0',0,0)).toBe('M 0,0 L 100,0');
  });
  it('insets each end independently without moving marker tips', () => {
    expect(Number(trimArrowPath('M 0,0 L 100,0',0,3.6).split(' L ')[1].split(',')[0])).toBeCloseTo(96.4);
    expect(Number(trimArrowPath('M 0,0 L 100,0',3.6,0).split(' ')[1].split(',')[0])).toBeCloseTo(3.6);
  });
  it('preserves Bezier paths, trims short terminal segments and handles zero length', () => {
    expect(trimArrowPath('M 0,0 Q 50,80 100,0',0,3)).toContain(' Q ');
    expect(trimArrowPath('M 0,0 C 30,80 70,80 100,0',3,3)).toContain(' C ');
    expect(trimArrowPath('M 0,0 L 98,0 L 100,0',0,4)).toBe('M 0,0 L 96,0');
    expect(trimArrowPath('M 0,0 L 0,0',4,4)).toBe('M 0,0 L 0,0');
    const short=trimArrowPath('M 0,0 L 1,0',4,4);
    expect(short).not.toContain('NaN');
  });
});
