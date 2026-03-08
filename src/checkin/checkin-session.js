/**
 * AnyRouter Session 签到模块
 * 直接使用 session 和 api_user 进行签到
 */

import { chromium } from 'playwright';
import axios from 'axios';
import { createHTTP2Adapter } from 'axios-http2-adapter';
import { fileURLToPath } from 'url';
import { addKeys, updateKeyInfo } from '../api/index.js';

class AnyRouterSessionSignIn {
	constructor(baseUrl = 'https://anyrouter.top') {
		this.baseUrl = baseUrl;
	}

	/**
	 * 生成随机延迟时间（模拟真人操作）
	 */
	getRandomDelay(min = 500, max = 1500) {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	/**
	 * 等待随机时间
	 */
	async randomDelay(min = 500, max = 1500) {
		const delay = this.getRandomDelay(min, max);
		await new Promise((resolve) => setTimeout(resolve, delay));
	}

	/**
	 * 使用 Playwright 获取 WAF cookies
	 * @returns {Object|null} - WAF cookies 对象
	 */
	async getWafCookies() {
		console.log('[处理中] 启动浏览器获取 WAF cookies...');

		let context = null;
		let page = null;

		try {
			// 启动浏览器（使用持久化上下文）
			context = await chromium.launchPersistentContext('', {
				headless: true,
				userAgent:
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
				viewport: { width: 1920, height: 1080 },
				ignoreHTTPSErrors: true, // 忽略HTTPS证书错误
				args: [
					'--disable-blink-features=AutomationControlled',
					'--disable-dev-shm-usage',
					'--disable-web-security',
					'--disable-features=VizDisplayCompositor',
					'--no-sandbox',
				],
			});

			page = await context.newPage();

			console.log('[处理中] 访问登录页获取初始 cookies...');
			await page.goto(`${this.baseUrl}/login`, {
				waitUntil: 'networkidle',
				timeout: 30000,
			});

			// 等待页面完全加载
			try {
				await page.waitForFunction('document.readyState === "complete"', { timeout: 5000 });
			} catch {
				await this.randomDelay(3000, 3000);
			}

			// 获取 cookies
			const cookies = await context.cookies();
			const wafCookies = {};

			for (const cookie of cookies) {
				if (['acw_tc', 'cdn_sec_tc', 'acw_sc__v2'].includes(cookie.name)) {
					wafCookies[cookie.name] = cookie.value;
				}
			}

			console.log(`[信息] 获取到 ${Object.keys(wafCookies).length} 个 WAF cookies`);

			// 检查必需的 cookies
			const requiredCookies = ['acw_tc', 'cdn_sec_tc', 'acw_sc__v2'];
			const missingCookies = requiredCookies.filter((c) => !wafCookies[c]);

			if (missingCookies.length > 0) {
				console.log(`[失败] 缺少 WAF cookies: ${missingCookies.join(', ')}`);
				await context.close();
				return null;
			}

			console.log('[成功] 成功获取所有 WAF cookies');
			await context.close();

			return wafCookies;
		} catch (error) {
			console.log(`[失败] 获取 WAF cookies 时发生错误: ${error.message}`);
			if (context) await context.close();
			return null;
		}
	}

	/**
	 * 获取令牌列表
	 * @param {Object} page - Playwright page 对象
	 * @param {string} apiUser - API User ID
	 * @returns {Array} - 令牌列表
	 */
	async getTokens(page, apiUser) {
		try {
			console.log('[令牌] 获取令牌列表...');
			const result = await page.evaluate(
				async ({ baseUrl, apiUser }) => {
					try {
						const response = await fetch(`${baseUrl}/api/token/?p=0&size=100`, {
							method: 'GET',
							headers: {
								Accept: 'application/json, text/plain, */*',
								'new-api-user': apiUser,
							},
							credentials: 'include',
						});

						const data = await response.json();
						return {
							status: response.status,
							data: data,
						};
					} catch (error) {
						return {
							error: error.message,
						};
					}
				},
				{ baseUrl: this.baseUrl, apiUser }
			);

			if (result.error) {
				console.log(`[失败] 获取令牌列表失败: ${result.error}`);
				return [];
			}

			if (result.status === 200 && result.data.success) {
				const tokens = result.data.data || [];
				console.log(`[信息] 获取到 ${tokens.length} 个令牌`);
				return tokens;
			}

			return [];
		} catch (error) {
			console.log(`[失败] 获取令牌列表时发生错误: ${error.message}`);
			return [];
		}
	}

	/**
	 * 删除令牌
	 * @param {Object} page - Playwright page 对象
	 * @param {string} apiUser - API User ID
	 * @param {number} tokenId - 令牌ID
	 * @returns {boolean} - 是否删除成功
	 */
	async deleteToken(page, apiUser, tokenId) {
		try {
			console.log(`[令牌] 删除令牌 ID: ${tokenId}...`);
			const result = await page.evaluate(
				async ({ baseUrl, apiUser, tokenId }) => {
					try {
						const response = await fetch(`${baseUrl}/api/token/${tokenId}`, {
							method: 'DELETE',
							headers: {
								Accept: 'application/json, text/plain, */*',
								'new-api-user': apiUser,
							},
							credentials: 'include',
						});

						const data = await response.json();
						return {
							status: response.status,
							data: data,
						};
					} catch (error) {
						return {
							error: error.message,
						};
					}
				},
				{ baseUrl: this.baseUrl, apiUser, tokenId }
			);

			if (result.error) {
				console.log(`[失败] 删除令牌失败: ${result.error}`);
				return false;
			}

			if (result.status === 200 && result.data.success) {
				console.log(`[成功] 令牌 ${tokenId} 删除成功`);
				return true;
			}

			console.log(`[失败] 删除令牌失败: ${result.data.message || '未知错误'}`);
			return false;
		} catch (error) {
			console.log(`[失败] 删除令牌时发生错误: ${error.message}`);
			return false;
		}
	}

	/**
	 * 创建新令牌
	 * @param {Object} page - Playwright page 对象
	 * @param {string} apiUser - API User ID
	 * @param {Object} tokenConfig - 令牌配置（可选）
	 * @returns {boolean} - 是否创建成功
	 */
	async createToken(page, apiUser, tokenConfig = {}) {
		try {
			console.log('[令牌] 创建新令牌...');

			// 根据是否无限额度构建请求体
			const requestBody = {
				name: tokenConfig.name || 'dw',
				expired_time: -1,
				model_limits_enabled: false,
				model_limits: '',
				allow_ips: '',
				group: 'default',
			};

			// 如果是无限额度
			if (tokenConfig.unlimited_quota) {
				requestBody.unlimited_quota = true;
			} else {
				// 非无限额度，需要提供 remain_quota
				requestBody.remain_quota = tokenConfig.remain_quota || 500000;
			}

			const result = await page.evaluate(
				async ({ baseUrl, apiUser, requestBody }) => {
					try {
						const response = await fetch(`${baseUrl}/api/token/`, {
							method: 'POST',
							headers: {
								Accept: 'application/json, text/plain, */*',
								'Content-Type': 'application/json',
								'new-api-user': apiUser,
							},
							body: JSON.stringify(requestBody),
							credentials: 'include',
						});

						const data = await response.json();
						return {
							status: response.status,
							data: data,
						};
					} catch (error) {
						return {
							error: error.message,
						};
					}
				},
				{ baseUrl: this.baseUrl, apiUser, requestBody }
			);

			if (result.error) {
				console.log(`[失败] 创建令牌失败: ${result.error}`);
				return false;
			}

			if (result.status === 200 && result.data.success) {
				console.log('[成功] 令牌创建成功');
				return true;
			}

			console.log(`[失败] 创建令牌失败: ${result.data.message || '未知错误'}`);
			return false;
		} catch (error) {
			console.log(`[失败] 创建令牌时发生错误: ${error.message}`);
			return false;
		}
	}

	/**
	 * 更新令牌信息
	 * @param {Object} page - Playwright page 对象
	 * @param {string} apiUser - API User ID
	 * @param {Object} tokenData - 完整的令牌信息
	 * @returns {Object|null} - 更新后的令牌信息
	 */
	async updateToken(page, apiUser, tokenData) {
		try {
			console.log(`[令牌] 更新令牌 ID: ${tokenData.id}...`);
			const result = await page.evaluate(
				async ({ baseUrl, apiUser, tokenData }) => {
					try {
						const response = await fetch(`${baseUrl}/api/token/`, {
							method: 'PUT',
							headers: {
								Accept: 'application/json, text/plain, */*',
								'Content-Type': 'application/json',
								'new-api-user': apiUser,
							},
							body: JSON.stringify(tokenData),
							credentials: 'include',
						});

						const data = await response.json();
						return {
							status: response.status,
							data: data,
						};
					} catch (error) {
						return {
							error: error.message,
						};
					}
				},
				{ baseUrl: this.baseUrl, apiUser, tokenData }
			);

			if (result.error) {
				console.log(`[失败] 更新令牌失败: ${result.error}`);
				return null;
			}

			if (result.status === 200 && result.data.success) {
				console.log(`[成功] 令牌 ${tokenData.id} 更新成功`);
				return result.data.data;
			}

			console.log(`[失败] 更新令牌失败: ${result.data.message || '未知错误'}`);
			return null;
		} catch (error) {
			console.log(`[失败] 更新令牌时发生错误: ${error.message}`);
			return null;
		}
	}

	/**
	 * 获取用户信息
	 * @param {Object} cookies - cookies 对象
	 * @param {string} apiUser - API User ID
	 * @returns {Object|null} - 用户信息
	 */
	async getUserInfo(cookies, apiUser) {
		try {
			const cookieString = Object.entries(cookies)
				.map(([key, value]) => `${key}=${value}`)
				.join('; ');

			// 使用 HTTP/2
			const axiosInstance = axios.create({
				adapter: createHTTP2Adapter({
					force: true,
				}),
			});

			const response = await axiosInstance.get(`${this.baseUrl}/api/user/self`, {
				headers: {
					Cookie: cookieString,
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
					Accept: 'application/json, text/plain, */*',
					'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
					'Accept-Encoding': 'gzip, deflate, br, zstd',
					Referer: `${this.baseUrl}/console`,
					Origin: this.baseUrl,
					Connection: 'keep-alive',
					'Sec-Fetch-Dest': 'empty',
					'Sec-Fetch-Mode': 'cors',
					'Sec-Fetch-Site': 'same-origin',
					'new-api-user': apiUser,
				},
				timeout: 30000,
			});

			if (response.status === 200 && response.data.success) {
				const userData = response.data.data || {};
				return {
					username: userData.username,
					email: userData.email,
					quota: userData.quota,
					usedQuota: userData.used_quota,
					affCode: userData.aff_code,
				};
			}
			return null;
		} catch (error) {
			console.log(`[失败] 获取用户信息失败: ${error.message.substring(0, 50)}...`);
			return null;
		}
	}

	/**
	 * 使用 session 和 api_user 执行签到（使用 Playwright）
	 * @param {string} session - Session cookie 值
	 * @param {string} apiUser - API User ID
	 * @param {Object} accountInfo - 账号信息（可选，用于令牌管理）
	 * @returns {Object|null} - 签到结果 { success: boolean, userInfo: object }
	 */
	async signIn(session, apiUser, accountInfo = null) {
		console.log(`\n[签到] 开始处理 Session 签到 (API User: ${apiUser})`);

		let context = null;
		let page = null;

		try {
			// 启动浏览器
			console.log('[浏览器] 启动浏览器...');
			context = await chromium.launchPersistentContext('', {
				ignoreHTTPSErrors: true, // 忽略HTTPS证书错误
				headless: true,
				userAgent:
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
				viewport: { width: 1920, height: 1080 },
				args: [
					'--disable-blink-features=AutomationControlled',
					'--disable-dev-shm-usage',
					'--disable-web-security',
					'--disable-features=VizDisplayCompositor',
					'--no-sandbox',
				],
			});

			page = await context.newPage();

			// 设置 cookies
			console.log('[Cookie] 设置 session cookie...');
			await context.addCookies([
				{
					name: 'session',
					value: session,
					domain: new URL(this.baseUrl).hostname,
					path: '/',
					httpOnly: true,
					secure: true,
					sameSite: 'Lax',
				},
			]);

			// 访问登录页以获取 WAF cookies
			console.log('[页面] 访问登录页获取 WAF cookies...');
			await page.goto(`${this.baseUrl}/login`, {
				waitUntil: 'networkidle',
				timeout: 30000,
			});

			await this.randomDelay(2000, 3000);

			// 使用 page.evaluate 执行签到请求
			console.log('[网络] 执行签到...');
			const result = await page.evaluate(
				async ({ baseUrl, apiUser }) => {
					try {
						const response = await fetch(`${baseUrl}/api/user/sign_in`, {
							method: 'POST',
							headers: {
								Accept: 'application/json, text/plain, */*',
								'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
								'Content-Type': 'application/json',
								'new-api-user': apiUser,
								'X-Requested-With': 'XMLHttpRequest',
							},
							body: JSON.stringify({}),
							credentials: 'include',
						});

						const data = await response.json();
						return {
							status: response.status,
							data: data,
						};
					} catch (error) {
						return {
							error: error.message,
						};
					}
				},
				{ baseUrl: this.baseUrl, apiUser }
			);

			console.log(`[响应] 签到响应状态码 ${result.status}`);
			console.log('[响应] 响应数据:', JSON.stringify(result.data, null, 2));

			if (result.error) {
				console.log(`[失败] 签到请求失败: ${result.error}`);
				await context.close();
				return { success: false, error: result.error };
			}

			if (result.status === 200) {
				const data = result.data;
				if (data.ret === 1 || data.code === 0 || data.success) {
					console.log('[成功] 签到成功!');

					// 获取用户信息
					console.log('[信息] 获取用户信息...');
					const userInfo = await page.evaluate(
						async ({ baseUrl, apiUser }) => {
							try {
								const response = await fetch(`${baseUrl}/api/user/self`, {
									method: 'GET',
									headers: {
										Accept: 'application/json, text/plain, */*',
										'new-api-user': apiUser,
									},
									credentials: 'include',
								});

								const data = await response.json();
								if (data.success && data.data) {
									return {
										username: data.data.username,
										email: data.data.email,
										quota: data.data.quota,
										usedQuota: data.data.used_quota,
										affCode: data.data.aff_code,
										affQuota: data.data.aff_quota || 0,
										status: data.data.status, // 用户状态：1-正常，2-封禁
									};
								}
								return null;
							} catch (error) {
								return null;
							}
						},
						{ baseUrl: this.baseUrl, apiUser }
					);

					if (userInfo) {
						// 检查账号是否被封禁（status=2 表示封禁）
						if (userInfo.status === 2) {
							console.log(`[警告] 账号 ${userInfo.username} 已被封禁 (status=2)`);
							await context.close();
							return { success: true, userInfo };
						}

						console.log(`[信息] 用户名: ${userInfo.username}`);
						console.log(`[信息] 邮箱: ${userInfo.email}`);
						console.log(`[信息] 余额: $${(userInfo.quota / 500000).toFixed(2)}`);
						console.log(`[信息] 已使用: $${(userInfo.usedQuota / 500000).toFixed(2)}`);
						console.log(`[信息] 推广码: ${userInfo.affCode}`);

						// 检查是否有邀请奖励需要划转
						if (userInfo.affQuota && userInfo.affQuota > 0) {
							console.log(`[信息] 检测到邀请奖励: $${(userInfo.affQuota / 500000).toFixed(2)}`);
							console.log('[处理中] 开始划转邀请奖励到余额...');

							const transferResult = await page.evaluate(
								async ({ baseUrl, apiUser, affQuota }) => {
									try {
										const response = await fetch(`${baseUrl}/api/user/aff_transfer`, {
											method: 'POST',
											headers: {
												Accept: 'application/json, text/plain, */*',
												'Content-Type': 'application/json',
												'new-api-user': apiUser,
											},
											body: JSON.stringify({ quota: affQuota }),
											credentials: 'include',
										});

										const data = await response.json();
										return {
											success: data.success,
											message: data.message,
										};
									} catch (error) {
										return {
											success: false,
											error: error.message,
										};
									}
								},
								{ baseUrl: this.baseUrl, apiUser, affQuota: userInfo.affQuota }
							);

							// 不管划转成功或失败,都直接更新余额
							userInfo.quota = userInfo.quota + userInfo.affQuota;
							userInfo.affQuota = 0;

							if (transferResult.success) {
								console.log('[成功] 划转成功!');
								console.log(`[信息] 划转后余额: $${(userInfo.quota / 500000).toFixed(2)}`);
							} else {
								console.log(`[失败] 划转失败: ${transferResult.error || transferResult.message}`);
								console.log(`[信息] 当前余额: $${(userInfo.quota / 500000).toFixed(2)}`);
							}
						}

						// 收集本次待创建的出售令牌名称，用于后续批量上传
						const pendingSellTokenNames = [];

						// 获取令牌信息之前，根据账号配置管理令牌
						if (accountInfo && accountInfo.tokens && Array.isArray(accountInfo.tokens)) {
							console.log(
								`[令牌管理] 发现账号配置中有 ${accountInfo.tokens.length} 个令牌配置，开始处理...`
							);

							for (const tokenConfig of accountInfo.tokens) {
								// 如果有 id 且标记为删除，则删除该令牌
								if (tokenConfig.id && tokenConfig.is_deleted) {
									console.log(`[令牌管理] 准备删除令牌 ID: ${tokenConfig.id}`);
									await this.deleteToken(page, apiUser, tokenConfig.id);
								}
								// 如果没有 id，表示是待创建的新令牌
								else if (!tokenConfig.id) {
									console.log('[令牌管理] 准备创建新令牌');
									const createSuccess = await this.createToken(page, apiUser, {
										unlimited_quota: tokenConfig.unlimited_quota || false,
										remain_quota: tokenConfig.remain_quota,
										name: tokenConfig.name,
									});

									// 记录创建成功的出售令牌名称
									if (createSuccess && tokenConfig.name && tokenConfig.name.startsWith('出售_')) {
										pendingSellTokenNames.push({
											name: tokenConfig.name,
											remain_quota: tokenConfig.remain_quota,
										});
									}
								}
							}

							console.log('[令牌管理] 令牌管理完成');
						}

						// 获取令牌信息
						let tokens = await this.getTokens(page, apiUser);

						// 如果没有令牌，先创建一个
						if (tokens.length === 0) {
							const created = await this.createToken(page, apiUser, { unlimited_quota: true });
							if (created) {
								tokens = await this.getTokens(page, apiUser);
							}
						} else {
							// 补充令牌额度功能
							// 如果已有令牌，查询accountInfo.tokens中是否有补充额度的，字段为supplement_quota
							// 如果有，找到tokens中对应的令牌，增加其remain_quota（remain_quota + supplement_quota），调用更新token接口
							if (accountInfo && accountInfo.tokens && Array.isArray(accountInfo.tokens)) {
								const tokensToSupplement = accountInfo.tokens.filter(
									(t) => t.supplement_quota && t.supplement_quota > 0
								);

								if (tokensToSupplement.length > 0) {
									console.log(`[令牌管理] 发现 ${tokensToSupplement.length} 个令牌需要补充额度`);

									for (const configToken of tokensToSupplement) {
										// 通过id匹配令牌
										const matchedToken = tokens.find((t) => t.id === configToken.id);
										if (matchedToken) {
											const newRemainQuota =
												(matchedToken.remain_quota || 0) + configToken.supplement_quota;
											console.log(
												`[令牌管理] 令牌 ${matchedToken.id} 补充额度: ${configToken.supplement_quota} -> 新额度: ${newRemainQuota}`
											);

											// 构建完整的令牌数据用于更新
											const updatedTokenData = {
												...matchedToken,
												remain_quota: newRemainQuota,
											};

											const updateResult = await this.updateToken(page, apiUser, updatedTokenData);
											if (updateResult) {
												// 更新本地tokens数组中的数据
												matchedToken.remain_quota = updateResult.remain_quota;
												console.log(
													`[令牌管理] 令牌 ${matchedToken.id} 额度补充成功，当前额度: ${updateResult.remain_quota}`
												);

												// 同步更新服务端 AI Key 信息
												if (configToken.key) {
													const keyUpdateResult = await updateKeyInfo({
														key: configToken.key,
														incData: {
															// 增量更新初始额度（转换为美元）
															quota: configToken.supplement_quota / 500000,
														},
														updateData: {
															// 更新剩余额度和已使用额度（转换为美元）
															remain_quota: updateResult.remain_quota / 500000,
															used_quota: (updateResult.used_quota || 0) / 500000,
															quota_update_date: Date.now(),
														},
													});

													if (keyUpdateResult.success) {
														console.log('[令牌管理] 服务端 Key 信息同步成功');
													} else {
														console.log(
															`[令牌管理] 服务端 Key 信息同步失败: ${keyUpdateResult.error}`
														);
													}
												}
											}
										} else {
											console.log(`[令牌管理] 未找到ID为 ${configToken.id} 的令牌，跳过补充`);
										}
									}
								}
							}
						}

						// 如果有待上传的出售令牌，批量上传到服务器
						if (pendingSellTokenNames.length > 0) {
							console.log(
								`[令牌管理] 检测到 ${pendingSellTokenNames.length} 个出售令牌，准备批量上传...`
							);

							// 从获取到的令牌中匹配出售令牌
							const keysToUpload = [];
							for (const pending of pendingSellTokenNames) {
								const matchedToken = tokens.find((t) => t.name === pending.name);
								if (matchedToken && matchedToken.key) {
									const quota = pending.remain_quota ? pending.remain_quota / 500000 : 0;
									keysToUpload.push({
										key: matchedToken.key,
										key_type: 'anyrouter',
										is_sold: false,
										quota: quota,
										source_name: `${accountInfo.username || ''}&${pending.name}`,
										account_id: accountInfo._id,
									});
								}
							}

							if (keysToUpload.length > 0) {
								const uploadResult = await addKeys(keysToUpload);
								if (uploadResult.success) {
									console.log(`[令牌管理] 批量上传成功，共 ${keysToUpload.length} 个Key`);
								} else {
									console.log(`[令牌管理] 批量上传失败: ${uploadResult.error}`);
								}
							}
						}

						// 检测出售令牌的已使用额度是否有变化，如果有变化则同步更新服务端
						if (accountInfo && accountInfo.tokens && Array.isArray(accountInfo.tokens)) {
							// 筛选出售令牌（名称以"出售_"开头或is_sold=true，且有key的令牌）
							const sellTokenConfigs = accountInfo.tokens.filter(
								(t) => ((t.name && t.name.startsWith('出售_')) || t.is_sold === true) && t.key
							);

							for (const configToken of sellTokenConfigs) {
								// 通过 key 或 id 匹配当前获取到的令牌
								const currentToken = tokens.find(
									(t) => t.key === configToken.key || t.id === configToken.id
								);

								if (currentToken) {
									const oldUsedQuota = configToken.used_quota || 0;
									const newUsedQuota = currentToken.used_quota || 0;
									const isSold = configToken.is_sold === true;

									// 检查已使用额度是否有变化，或者是已售出令牌（需要强制更新）
									if (newUsedQuota !== oldUsedQuota || isSold) {
										const logPrefix = isSold
											? `[令牌管理] 已售出令牌 ${configToken.name}`
											: `[令牌管理] 出售令牌 ${configToken.name}`;

										if (newUsedQuota !== oldUsedQuota) {
											console.log(
												`${logPrefix} 已使用额度变化: ${oldUsedQuota} -> ${newUsedQuota}`
											);
										} else {
											console.log(`${logPrefix} 强制更新额度信息`);
										}

										const keyUpdateResult = await updateKeyInfo({
											key: configToken.key,
											updateData: {
												// 更新剩余额度和已使用额度（转换为美元）
												remain_quota: (currentToken.remain_quota || 0) / 500000,
												used_quota: newUsedQuota / 500000,
												quota_update_date: Date.now(),
											},
										});

										if (keyUpdateResult.success) {
											console.log(`${logPrefix} 服务端信息同步成功`);
										} else {
											console.log(`${logPrefix} 服务端信息同步失败: ${keyUpdateResult.error}`);
										}
									}
								}
							}
						}

						// 过滤令牌数据，只保留需要的字段
						if (tokens.length > 0) {
							userInfo.tokens = tokens.map((token) => ({
								id: token.id,
								key: token.key,
								name: token.name,
								unlimited_quota: token.unlimited_quota,
								used_quota: token.used_quota,
								remain_quota: token.remain_quota,
								supplement_quota: 0,
								status: token.status,
							}));
							console.log(`[信息] 成功获取 ${userInfo.tokens.length} 个令牌信息`);
						}
					}

					await context.close();
					return { success: true, userInfo };
				} else {
					const errorMsg = data.msg || data.message || '未知错误';
					console.log(`[失败] 签到失败 - ${errorMsg}`);
					console.log('[调试] 完整响应:', JSON.stringify(data, null, 2));
					await context.close();
					return { success: false, error: errorMsg };
				}
			} else {
				console.log(`[失败] 签到失败 - HTTP ${result.status}`);
				console.log('[调试] 响应体:', JSON.stringify(result.data, null, 2));
				await context.close();
				return { success: false, error: `HTTP ${result.status}` };
			}
		} catch (error) {
			console.log('[失败] 签到过程中发生错误:');
			console.log(`[错误] 消息: ${error.message}`);
			console.log('[错误] 堆栈:', error.stack);
			if (context) await context.close();
			return { success: false, error: error.message };
		}
	}
}

// 导出模块
export default AnyRouterSessionSignIn;

// 如果直接运行此文件，执行签到测试
const isMainModule = fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
	(async () => {
		const signer = new AnyRouterSessionSignIn();

		console.log('===== AnyRouter Session 签到测试 =====\n');

		// 示例：从命令行参数获取 session 和 api_user
		// 用法：node checkin-session.js <session> <api_user>
		const session =
			process.argv[2] ||
			'MTc2MjI5ODE4NXxEWDhFQVFMX2dBQUJFQUVRQUFEXzRfLUFBQWNHYzNSeWFXNW5EQVFBQW1sa0EybHVkQVFGQVAwQ3ZGWUdjM1J5YVc1bkRBb0FDSFZ6WlhKdVlXMWxCbk4wY21sdVp3d1BBQTFzYVc1MWVHUnZYemc1TmpReUJuTjBjbWx1Wnd3R0FBUnliMnhsQTJsdWRBUUNBQUlHYzNSeWFXNW5EQWdBQm5OMFlYUjFjd05wYm5RRUFnQUNCbk4wY21sdVp3d0hBQVZuY205MWNBWnpkSEpwYm1jTUNRQUhaR1ZtWVhWc2RBWnpkSEpwYm1jTUJRQURZV1ptQm5OMGNtbHVad3dHQUFSak1UVkJCbk4wY21sdVp3d05BQXR2WVhWMGFGOXpkR0YwWlFaemRISnBibWNNRGdBTWJVSnhVVmRXVVZwQlFYZHV8Qrat05CfISodKG799ailLIv3aCMk6c-YCJ7z5UcA-Kg=';
		const apiUser = process.argv[3] || '89643';

		if (!session || !apiUser) {
			console.log('[错误] 请提供 session 和 api_user 参数');
			console.log('用法：node checkin-session.js <session> <api_user>');
			process.exit(1);
		}

		const result = await signer.signIn(session, apiUser);

		if (result && result.success) {
			console.log('\n===== 签到成功 =====');
			if (result.userInfo) {
				console.log(`用户名: ${result.userInfo.username}`);
				console.log(`余额: $${(result.userInfo.quota / 500000).toFixed(2)}`);
			}
		} else {
			console.log('\n===== 签到失败 =====');
			if (result && result.error) {
				console.log(`错误: ${result.error}`);
			}
		}
	})();
}
