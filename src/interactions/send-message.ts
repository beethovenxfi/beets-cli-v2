import { client } from '../client/discord-client';
import { MessageOptions, MessagePayload, TextChannel } from 'discord.js';

export enum ChannelId {
    MULTISIG_TX = '902805527833227274',
    SERVER_STATUS = '898532283588431872',
    ONCHAIN_TXNS = '897191252125159434',
}

export async function sendMessage(channelId: ChannelId, message: string | MessagePayload | MessageOptions) {
    const channel = (await client.channels.fetch(channelId)) as TextChannel;
    await channel.send(message);
}
