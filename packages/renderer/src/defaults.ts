import Blockquote from './blocks/Blockquote.vue';
import BulletList from './blocks/BulletList.vue';
import CodeBlock from './blocks/CodeBlock.vue';
import HardBreak from './blocks/HardBreak.vue';
import Heading from './blocks/Heading.vue';
import ListItem from './blocks/ListItem.vue';
import OrderedList from './blocks/OrderedList.vue';
import Paragraph from './blocks/Paragraph.vue';
import Text from './blocks/Text.vue';
import VulseCallout from './blocks/VulseCallout.vue';
import type { BlockComponentMap } from './types.js';

export const defaultComponents: BlockComponentMap = {
  paragraph: Paragraph,
  heading: Heading,
  bulletList: BulletList,
  orderedList: OrderedList,
  listItem: ListItem,
  blockquote: Blockquote,
  codeBlock: CodeBlock,
  hardBreak: HardBreak,
  text: Text,
  vulseCallout: VulseCallout,
};
