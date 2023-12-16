import { Context, Schema } from 'koishi';
import EA from './service';

declare module 'koishi' {
    interface Context {
        ea: EA;
    }
}

export const name = 'ea';

interface Account {
    name: string;
    personaId: string;
    remid: string;
    sid: string;
    remidid: string;
}

export interface Config {
    accounts: Account[];
}

export const Config: Schema<Config> = Schema.object({
    accounts: Schema.array(Schema.object({
        name: Schema.string().disabled().description('名称(自动获取)'),
        personaId: Schema.string().disabled().description('账号PersonaId(自动获取)'),
        remid: Schema.string().required().role('secret').description('Cookie中的remid(需要勾选记住密码)'),
        sid: Schema.string().disabled().role('secret').description('Cookie中的sid(自动获取)'),
        remidid: Schema.string().hidden(),
    })).description('账号列表(第一个是默认账号)'),
});

export function apply(ctx: Context, config: Config) {
    ctx.plugin(EA, config);
}
