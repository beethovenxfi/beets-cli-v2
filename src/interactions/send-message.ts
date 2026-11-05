import { client } from '../client/discord-client';
import { MessageOptions, MessagePayload, TextChannel } from 'discord.js';

export enum ChannelId {
    MULTISIG_TX = '902805527833227274',
    SERVER_STATUS = '898532283588431872',
    ONCHAIN_TXNS = '897191252125159434',
}

export async function sendMessage(channelId: ChannelId, message: string | MessagePayload | MessageOptions) {
    // Crons start before the client is ready; until then guilds aren't cached and channels.fetch returns null
    if (!client.isReady()) await new Promise((resolve) => client.once('ready', resolve));
    const channel = (await client.channels.fetch(channelId)) as TextChannel | null;
    if (!channel) throw new Error(`Discord channel ${channelId} not found`);
    await channel.send(message);
}
