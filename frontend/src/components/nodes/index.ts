import { ImageNode } from './ImageNode';
import { TextNode } from './TextNode';
import { RectangleNode } from './RectangleNode';
import { ArrowNode } from './ArrowNode';
import { PlotNode } from './PlotNode';

export const nodeTypes = {
  image: ImageNode,
  text: TextNode,
  rectangle: RectangleNode,
  arrow: ArrowNode,
  plot: PlotNode,
};

export { ImageNode, TextNode, RectangleNode, ArrowNode, PlotNode };
