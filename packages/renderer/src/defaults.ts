import type { BlockComponentMap } from './types.js';
import Paragraph from './blocks/Paragraph.vue';
import Heading from './blocks/Heading.vue';
import BulletList from './blocks/BulletList.vue';
import OrderedList from './blocks/OrderedList.vue';
import ListItem from './blocks/ListItem.vue';
import Blockquote from './blocks/Blockquote.vue';
import CodeBlock from './blocks/CodeBlock.vue';
import HardBreak from './blocks/HardBreak.vue';
import Text from './blocks/Text.vue';
import VulseCallout from './blocks/VulseCallout.vue';

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
