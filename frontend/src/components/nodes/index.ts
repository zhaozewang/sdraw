import { ImageNode } from './ImageNode';
import { TextNode } from './TextNode';
import { RectangleNode } from './RectangleNode';
import { ArrowNode } from './ArrowNode';

export const nodeTypes = {
  image: ImageNode,
  text: TextNode,
  rectangle: RectangleNode,
  arrow: ArrowNode,
};

export { ImageNode, TextNode, RectangleNode, ArrowNode };
