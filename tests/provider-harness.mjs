// Tests serialize requests with Node's real Request/FormData implementation.
// Outbound traffic is always intercepted; no provider is contacted.
export class ProviderHarness {
  constructor({script,outboundService}) {
    this.module=import('data:text/javascript;base64,'+Buffer.from(script).toString('base64'));
    this.outbound=outboundService;
  }
  async dispatchFetch(url,options) {
    const mod=await this.module,previous=globalThis.fetch;
    globalThis.fetch=async(input,init)=>this.outbound(new Request(input,init));
    try{return await mod.default.fetch(new Request(url,options));}
    finally{globalThis.fetch=previous;}
  }
  async dispose() {}
}
