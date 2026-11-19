export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.E3SRN8WE.js",app:"_app/immutable/entry/app.DxUhMpNo.js",imports:["_app/immutable/entry/start.E3SRN8WE.js","_app/immutable/chunks/CnBXTcWr.js","_app/immutable/chunks/DkFiIn9z.js","_app/immutable/chunks/BdmVkPbN.js","_app/immutable/entry/app.DxUhMpNo.js","_app/immutable/chunks/CnBXTcWr.js","_app/immutable/chunks/DI1UpiNb.js","_app/immutable/chunks/BNZoa2-V.js","_app/immutable/chunks/BdmVkPbN.js","_app/immutable/chunks/WpsTFPfT.js","_app/immutable/chunks/zWuEEcaw.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
