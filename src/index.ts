import AsyncLock from 'async-lock';
import { Context, Schema, Service } from 'koishi';
import request from 'superagent';

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

interface AuthParams {
    client_id: string;
    response_type: string;
    redirect_uri?: string;
    release_type?: string;
    [key: string]: string;
}

class EA extends Service {
    protected config: EA.Config;

    constructor(ctx: Context, config: EA.Config) {
        super(ctx, 'ea');
        for (const account of config.accounts) {
            if (!account.remid) continue;
            const remidid = Buffer.from(account.remid.split('.')[0], 'base64').toString().split(':')[2];
            if (account.remidid !== remidid) {
                account.remidid = remidid;
                delete account.name;
                delete account.personaId;
                delete account.sid;
            }
            if (config.accounts.filter((item) => item.remidid === remidid).length > 1) {
                throw new Error(`Duplicate account ${remidid}`);
            }
        }
        this.config = config;
    }

    protected async start() {
        for (const account of this.config.accounts) {
            if (account.personaId) continue;
            const { remid, sid, result } = await this._auth(account.remid, '', { client_id: 'ORIGIN_JS_SDK', response_type: 'token', redirect_uri: 'nucleus:rest' });
            const { access_token } = JSON.parse(result);
            const { body: { personas: { persona: [{ personaId, displayName }] } } } = await request
                .get('https://gateway.ea.com/proxy/identity/pids/me/personas')
                .set('Authorization', `Bearer ${access_token}`)
                .set('X-Expand-Results', 'true');
            account.personaId = (personaId as number).toString();
            account.name = displayName;
            account.remid = remid;
            account.sid = sid;
            this.logger.info(`Account ${displayName} added`);
            this.ctx.scope.parent.scope.update(this.config, false);
        }
    }

    protected lock = new AsyncLock();
    public auth(params: AuthParams, personaId?: number) {
        if (!this.config.accounts.length) throw new Error('No account');
        personaId ||= +this.config.accounts[0].personaId;
        return this.lock.acquire(personaId.toString(), async () => {
            const account = this.config.accounts.find((item) => +item.personaId === personaId);
            if (!account) throw new Error('Account not found');
            try {
                const { remid, sid, result } = await this._auth(account.remid, account.sid, params);
                if (account.remid !== remid) {
                    account.remid = remid;
                    account.sid = sid;
                    this.ctx.scope.parent.scope.update(this.config, false);
                }
                return result;
            } catch (error) {
                error.account = { name: account.name, personaId: account.personaId };
                if (error.message === 'Invalid Cookie') {
                    account.remid = '';
                    account.sid = '';
                    this.ctx.scope.parent.scope.update(this.config, false);
                }
                throw error;
            }
        });
    }

    protected async _auth(remid: string, sid: string, params: AuthParams) {
        const cookie = [remid && `remid=${remid}`, sid && `sid=${sid}`].join('; ');
        const response = await request
            .get('https://accounts.ea.com/connect/auth')
            .query(params)
            .set('Cookie', cookie)
            .redirects(0)
            .ok((res) => res.status !== 400);
        const newCookie: Record<string, string> = Object.fromEntries(((response.headers['set-cookie'] || response.headers['Set-Cookie'] || []) as unknown as string[]).map((item) => item.split(';')[0].split('=')));
        remid = newCookie.remid ?? remid;
        sid = newCookie.sid ?? sid;
        switch (response.status) {
            case 302:
                if (response.header.location.includes('fid=')) throw new Error('Invalid Cookie');
                return { remid, sid, result: response.header.location };
            case 200:
                return { remid, sid, result: response.text };
            default:
                throw new Error('Unknown Status');
        }
    }
}

namespace EA {
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
}

export default EA;
