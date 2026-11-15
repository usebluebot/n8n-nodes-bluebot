import { account } from './account';
import { chat } from './chat';
import { conversation } from './conversation';
import { device } from './device';
import { event } from './event';
import { file } from './file';
import { lookup } from './lookup';
import { message } from './message';
import { settings } from './settings';
import { stop } from './stop';
import { template } from './template';
import type { ResourceDefinition } from './types';
import { webhook } from './webhook';
import { webhookDelivery } from './webhookDelivery';

/**
 * Every resource of the BlueBot node, in the order the Resource list shows them. A new resource (contacts,
 * sequences) is one file exporting a `ResourceDefinition` and one line here.
 */
export const RESOURCES: ResourceDefinition[] = [account, chat, conversation, device, event, file, lookup, message, settings, stop, template, webhook, webhookDelivery];
