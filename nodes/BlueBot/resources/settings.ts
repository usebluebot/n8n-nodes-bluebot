import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { toApiDateTime } from '../../shared/dates';
import { blueBotApiRequest } from '../../shared/transport';
import type { ResourceDefinition } from './types';
import { itemsOf, showFor } from './types';

const RESOURCE = 'settings';

const properties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		options: [
			{ name: 'Get', value: 'get', description: 'Get the sending settings', action: 'Get the settings' },
			{ name: 'Update', value: 'update', description: 'Change the sending settings', action: 'Update the settings' },
		],
		default: 'get',
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(RESOURCE, ['update']),
		default: {},
		options: [
			{
				displayName: 'Expiry Hours',
				name: 'expiryHours',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 168,
				},
				default: 24,
				description: 'A text still waiting this long after it was due expires, 1 to 168',
			},
			{
				displayName: 'Inbound Mode',
				name: 'inboundMode',
				type: 'options',
				options: [
					{ name: 'Everything', value: 'everything', description: 'Copy every chat on the Mac' },
					{ name: 'Replies', value: 'replies', description: 'Copy only chats with people BlueBot has texted' },
				],
				default: 'replies',
				description: 'Which chats the Mac copies to BlueBot',
			},
			{
				displayName: 'New People Per Day',
				name: 'newPeoplePerDay',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 1000,
				},
				default: 50,
				description: 'How many people you have never texted with BlueBot may be texted in a day, 0 to 1,000',
			},
			{
				displayName: 'Pace Seconds',
				name: 'paceSeconds',
				type: 'number',
				typeOptions: {
					minValue: 5,
					maxValue: 300,
				},
				default: 20,
				description: 'Seconds between texts, 5 to 300',
			},
			{
				displayName: 'Paused Until',
				name: 'pausedUntil',
				type: 'dateTime',
				default: '',
				description: 'Pause sending until this time',
			},
			{
				displayName: 'Quiet Hours Enabled',
				name: 'quietHoursEnabled',
				type: 'boolean',
				default: true,
				description: 'Whether texts wait through quiet hours',
			},
			{
				displayName: 'Quiet Hours End',
				name: 'quietHoursEnd',
				type: 'string',
				default: '08:00',
				placeholder: '08:00',
				description: 'When quiet hours end, as HH:MM in the account’s time zone',
			},
			{
				displayName: 'Quiet Hours Start',
				name: 'quietHoursStart',
				type: 'string',
				default: '21:00',
				placeholder: '21:00',
				description: 'When quiet hours start, as HH:MM in the account’s time zone',
			},
			{
				displayName: 'Resume Sending',
				name: 'resumeSending',
				type: 'boolean',
				default: true,
				description: 'Whether to end a pause now (sends paused_until as null)',
			},
			{
				displayName: 'Smart Quiet Hours',
				name: 'smartQuietHours',
				type: 'boolean',
				default: false,
				description: 'Whether to read quiet hours in the recipient’s zone, from their area code, where BlueBot knows it',
			},
			{
				displayName: 'Stop Words Enabled',
				name: 'stopWordsEnabled',
				type: 'boolean',
				default: true,
				description: 'Whether a reply of only a stop word, such as STOP, puts the person on the stop list',
			},
			{
				displayName: 'Time Zone',
				name: 'timeZone',
				type: 'string',
				default: '',
				placeholder: 'America/Chicago',
				description: 'An IANA time zone for quiet hours and daily limits',
			},
		],
	},
];

async function get(this: IExecuteFunctions, itemIndex: number) {
	const settings = await blueBotApiRequest.call(this, { method: 'GET', path: '/settings', itemIndex });
	return itemsOf(settings, itemIndex);
}

async function update(this: IExecuteFunctions, itemIndex: number) {
	const fields = this.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
	const body: IDataObject = {};
	if (typeof fields.timeZone === 'string' && fields.timeZone.trim()) body.time_zone = fields.timeZone.trim();
	if (typeof fields.paceSeconds === 'number') body.pace_seconds = fields.paceSeconds;
	if (typeof fields.newPeoplePerDay === 'number') body.new_people_per_day = fields.newPeoplePerDay;
	const quietHours: IDataObject = {};
	if (typeof fields.quietHoursEnabled === 'boolean') quietHours.enabled = fields.quietHoursEnabled;
	if (typeof fields.quietHoursStart === 'string' && fields.quietHoursStart.trim()) quietHours.start = fields.quietHoursStart.trim();
	if (typeof fields.quietHoursEnd === 'string' && fields.quietHoursEnd.trim()) quietHours.end = fields.quietHoursEnd.trim();
	if (Object.keys(quietHours).length) body.quiet_hours = quietHours;
	if (typeof fields.smartQuietHours === 'boolean') body.smart_quiet_hours = fields.smartQuietHours;
	if (typeof fields.stopWordsEnabled === 'boolean') body.stop_words = { enabled: fields.stopWordsEnabled };
	if (typeof fields.expiryHours === 'number') body.expiry_hours = fields.expiryHours;
	if (typeof fields.inboundMode === 'string' && fields.inboundMode) body.inbound_mode = fields.inboundMode;
	if (fields.resumeSending === true) body.paused_until = null;
	else {
		const pausedUntil = toApiDateTime(fields.pausedUntil, this.getTimezone());
		if (pausedUntil) body.paused_until = pausedUntil;
	}
	const settings = await blueBotApiRequest.call(this, { method: 'PATCH', path: '/settings', body, itemIndex });
	return itemsOf(settings, itemIndex);
}

export const settings: ResourceDefinition = {
	option: { name: 'Settings', value: RESOURCE },
	properties,
	handlers: { get, update },
};
