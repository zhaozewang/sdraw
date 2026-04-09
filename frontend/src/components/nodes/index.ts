import { ImageNode } from './ImageNode';
import { TextNode } from './TextNode';
import { RectangleNode } from './RectangleNode';
import { ArrowNode } from './ArrowNode';
import { PlotNode } from './PlotNode';
import { PenNode } from './PenNode';

export const nodeTypes = {
  image: ImageNode,
  text: TextNode,
  rectangle: RectangleNode,
  arrow: ArrowNode,
  plot: PlotNode,
  pen: PenNode,
};

export { ImageNode, TextNode, RectangleNode, ArrowNode, PlotNode, PenNode };
