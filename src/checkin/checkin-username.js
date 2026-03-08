/**
 * AnyRouter 登录签到模块
 * 通过 API 调用方式实现登录和签到
 */

import { chromium } from 'playwright';
import {
	applyStealthToContext,
	getStealthArgs,
	getIgnoreDefaultArgs,
} from '../utils/playwright-stealth.js';
import { fileURLToPath } from 'url';
import { addKeys, updateKeyInfo, updateAccountInfo } from '../api/index.js';

class AnyRouterSignIn {
	constructor() {
		this.baseUrl = 'https://anyrouter.top';
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
	 * 通过 API 调用方式实现登录和签到
	 * @param {string} username - 用户名或邮箱
	 * @param {string} password - 密码
	 * @param {Object} accountInfo - 账号信息（可选，用于令牌管理）
	 * @returns {Object|null} - { session: string, apiUser: string, userInfo: object }
	 */
	async loginAndGetSession(username, password, accountInfo = null) {
		console.log(`[登录签到] 开始处理账号: ${username}`);

		let browser = null;
		let context = null;
		let page = null;

		try {
			console.log('[浏览器] 启动 Chromium 浏览器（已启用反检测）...');

			// 启动浏览器（非持久化模式）
			browser = await chromium.launch({
				headless: true,
				args: getStealthArgs(),
				ignoreDefaultArgs: getIgnoreDefaultArgs(),
			});

			// 创建浏览器上下文，忽略 HTTPS 证书错误
			context = await browser.newContext({
				ignoreHTTPSErrors: true,
				viewport: { width: 1920, height: 1080 },
				userAgent:
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				locale: 'zh-CN',
				timezoneId: 'Asia/Shanghai',
				deviceScaleFactor: 1,
				isMobile: false,
				hasTouch: false,
				permissions: ['geolocation', 'notifications'],
				colorScheme: 'light',
			});

			// 应用反检测脚本到上下文
			await applyStealthToContext(context);

			// 创建新页面
			page = await context.newPage();

			// 步骤1: 打开首页，等待页面加载完成并稳定
			console.log('[页面] 访问首页，等待页面稳定...');
			await page.goto(this.baseUrl, {
				waitUntil: 'networkidle',
				timeout: 600000,
			});

			// 等待页面完全稳定
			await this.randomDelay(2000, 3000);

			// 步骤2: 调用登录接口（使用 page.evaluate + fetch）
			console.log('[API] 调用登录接口...', '2' + username + '1', '2' + password + '2');
			const loginResult = await page.evaluate(
				async ({ baseUrl, username, password }) => {
					try {
						const requestHeaders = {
							'Content-Type': 'application/json',
						};

						const response = await fetch(`${baseUrl}/api/user/login?turnstile=`, {
							method: 'POST',
							headers: requestHeaders,
							body: JSON.stringify({ username, password }),
							credentials: 'include', // 重要：确保接收 cookies
						});

						// 获取响应头（只能访问允许的响应头）
						const responseHeaders = {};
						response.headers.forEach((value, key) => {
							responseHeaders[key] = value;
						});

						const data = await response.json();

						return {
							success: response.ok,
							status: response.status,
							data: data,
							requestHeaders: requestHeaders,
							responseHeaders: responseHeaders,
						};
					} catch (error) {
						return {
							success: false,
							error: error.message,
						};
					}
				},
				{ baseUrl: this.baseUrl, username, password }
			);

			// 打印请求和响应头部
			if (loginResult.requestHeaders) {
				console.log(
					'[请求头] 登录接口请求头:',
					JSON.stringify(loginResult.requestHeaders, null, 2)
				);
			}
			if (loginResult.responseHeaders) {
				console.log(
					'[响应头] 登录接口响应头:',
					JSON.stringify(loginResult.responseHeaders, null, 2)
				);
			}

			if (!loginResult.success) {
				console.log(`[错误] 登录接口调用失败: ${loginResult.error || loginResult.status}`);
				return null;
			}

			if (!loginResult.data.success) {
				console.log(`[错误] 登录失败: ${loginResult.data.message || '未知原因'}`);

				// 登录失败且提示被封禁时，更新账号封禁状态
				if (accountInfo?._id && loginResult.data.message?.includes('用户已被封禁')) {
					console.log(`[封禁] 检测到账号可能被封禁，更新 is_banned 状态...`);
					const banResult = await updateAccountInfo(accountInfo._id, { is_banned: true });
					if (banResult.success) {
						console.log('[封禁] 账号已标记为封禁');
					} else {
						console.log(`[封禁] 更新封禁状态失败: ${banResult.error}`);
					}
				}

				return null;
			}

			const apiUser = loginResult.data.data?.id;
			if (!apiUser) {
				console.log('[错误] 登录响应中未找到用户 ID');
				return null;
			}

			console.log(`[成功] 登录成功，用户ID: ${apiUser}`);

			// 从浏览器 cookies 中获取 session
			const cookies = await context.cookies();
			const sessionCookie = cookies.find((c) => c.name === 'session');

			if (!sessionCookie) {
				console.log('[错误] 未能从 cookies 中获取 session');
				return null;
			}

			console.log('[成功] 获取到 session cookie');

			// 步骤3: 调用签到接口
			console.log('[API] 调用签到接口...');
			const signInResult = await page.evaluate(
				async ({ baseUrl, apiUser }) => {
					try {
						const requestHeaders = {
							'Content-Type': 'application/json',
							'new-api-user': String(apiUser),
							referer: `${baseUrl}/console`,
						};

						const response = await fetch(`${baseUrl}/api/user/sign_in`, {
							method: 'POST',
							headers: requestHeaders,
							credentials: 'include',
						});

						// 获取响应头
						const responseHeaders = {};
						response.headers.forEach((value, key) => {
							responseHeaders[key] = value;
						});

						const data = await response.json();

						return {
							success: response.ok,
							data: data,
							requestHeaders: requestHeaders,
							responseHeaders: responseHeaders,
						};
					} catch (error) {
						return {
							success: false,
							error: error.message,
						};
					}
				},
				{ baseUrl: this.baseUrl, apiUser }
			);

			// 打印请求和响应头部
			if (signInResult.requestHeaders) {
				console.log(
					'[请求头] 签到接口请求头:',
					JSON.stringify(signInResult.requestHeaders, null, 2)
				);
			}
			if (signInResult.responseHeaders) {
				console.log(
					'[响应头] 签到接口响应头:',
					JSON.stringify(signInResult.responseHeaders, null, 2)
				);
			}

			if (signInResult.success && signInResult.data.success) {
				console.log('[签到] 签到成功！');
			} else {
				console.log(
					`[签到] 签到失败: ${signInResult.data?.message || signInResult.error || '未知原因'}`
				);
			}

			// 步骤4: 获取用户信息（以这里的用户信息为准）
			console.log('[API] 获取用户信息...');
			const userInfoResult = await page.evaluate(
				async ({ baseUrl, apiUser }) => {
					try {
						const response = await fetch(`${baseUrl}/api/user/self`, {
							method: 'GET',
							headers: {
								'Content-Type': 'application/json',
								'new-api-user': String(apiUser),
								referer: `${baseUrl}/console`,
							},
							credentials: 'include',
						});

						const data = await response.json();

						return {
							success: response.ok,
							data: data,
						};
					} catch (error) {
						return {
							success: false,
							error: error.message,
						};
					}
				},
				{ baseUrl: this.baseUrl, apiUser }
			);

			let userData = null;
			if (userInfoResult.success && userInfoResult.data.success) {
				userData = userInfoResult.data.data;
				console.log(`[信息] 用户ID: ${userData.id}`);
				console.log(`[信息] 用户名: ${userData.username}`);
				console.log(`[信息] 邮箱: ${userData.email}`);
				console.log(`[信息] 余额: $${(userData.quota / 500000).toFixed(2)}`);
				console.log(`[信息] 已使用: $${(userData.used_quota / 500000).toFixed(2)}`);
				console.log(`[信息] 推广码: ${userData.aff_code}`);

				// 检查是否有邀请奖励需要划转
				if (userData.aff_quota && userData.aff_quota > 0) {
					console.log(`[信息] 检测到邀请奖励: $${(userData.aff_quota / 500000).toFixed(2)}`);
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
						{ baseUrl: this.baseUrl, apiUser: String(apiUser), affQuota: userData.aff_quota }
					);

					// 不管划转成功或失败,都直接更新余额
					userData.quota = userData.quota + userData.aff_quota;
					userData.aff_quota = 0;

					if (transferResult.success) {
						console.log('[成功] 划转成功!');
						console.log(`[信息] 划转后余额: $${(userData.quota / 500000).toFixed(2)}`);
					} else {
						console.log(`[失败] 划转失败: ${transferResult.error || transferResult.message}`);
						console.log(`[信息] 当前余额: $${(userData.quota / 500000).toFixed(2)}`);
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
							await this.deleteToken(page, String(apiUser), tokenConfig.id);
						}
						// 如果没有 id，表示是待创建的新令牌
						else if (!tokenConfig.id) {
							console.log('[令牌管理] 准备创建新令牌');
							const createSuccess = await this.createToken(page, String(apiUser), {
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
				let tokens = await this.getTokens(page, String(apiUser));

				// 如果没有令牌，先创建一个
				if (tokens.length === 0) {
					const created = await this.createToken(page, String(apiUser), { unlimited_quota: true });
					if (created) {
						tokens = await this.getTokens(page, String(apiUser));
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

									const updateResult = await this.updateToken(
										page,
										String(apiUser),
										updatedTokenData
									);
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
												console.log(`[令牌管理] 服务端 Key 信息同步失败: ${keyUpdateResult.error}`);
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
									console.log(`${logPrefix} 已使用额度变化: ${oldUsedQuota} -> ${newUsedQuota}`);
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
					userData.tokens = tokens.map((token) => ({
						id: token.id,
						key: token.key,
						name: token.name,
						unlimited_quota: token.unlimited_quota,
						used_quota: token.used_quota,
						remain_quota: token.remain_quota,
						status: token.status,
						supplement_quota: 0,
					}));
					console.log(`[信息] 成功获取 ${userData.tokens.length} 个令牌信息`);
				}
			} else {
				console.log(
					`[警告] 获取用户信息失败: ${userInfoResult.data?.message || userInfoResult.error || '未知原因'}`
				);
				// 使用登录接口返回的用户数据作为备用
				userData = loginResult.data.data;
			}

			// 返回结果
			console.log('[成功] 成功获取 session 和 api_user');
			return {
				session: sessionCookie.value,
				apiUser: String(apiUser),
				userInfo: userData,
			};
		} catch (error) {
			console.log(`[错误] 登录过程发生错误: ${error.message}`);
			return null;
		} finally {
			// 清理资源
			try {
				if (page && !page.isClosed()) await page.close();
				if (context) await context.close();
				if (browser) await browser.close();
				console.log('[浏览器] 浏览器已关闭');
			} catch (cleanupError) {
				console.log(`[警告] 清理浏览器资源时出错: ${cleanupError.message}`);
			}
		}
	}

	/**
	 * 批量处理多个账号
	 * @param {Array} accounts - 账号数组 [{username: '', password: ''}, ...]
	 * @returns {Array} - 结果数组
	 */
	async processAccounts(accounts) {
		const results = [];

		for (let i = 0; i < accounts.length; i++) {
			const account = accounts[i];
			console.log(`\n[处理] 开始处理账号 ${i + 1}/${accounts.length}`);

			const result = await this.loginAndGetSession(account.username, account.password);

			results.push({
				username: account.username,
				success: result !== null,
				data: result,
			});

			// 账号之间添加延迟，避免频繁操作
			if (i < accounts.length - 1) {
				console.log('[等待] 等待 5 秒后处理下一个账号...');
				await this.randomDelay(5000, 7000);
			}
		}

		return results;
	}
}

// 导出模块
export default AnyRouterSignIn;

// 如果直接运行此文件，执行注册
const isMainModule = fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
	(async () => {
		const signin = new AnyRouterSignIn();

		// 示例：单个账号登录
		console.log('===== AnyRouter 登录签到测试 =====\n');

		// 从环境变量或命令行参数获取账号信息
		const username = 'liyong2005';
		const password = 'liyong2005';

		const result = await signin.loginAndGetSession(username, password);

		if (result) {
			console.log('\n===== 登录成功，获取到以下信息 =====');
			console.log(`Session: ${result.session.substring(0, 50)}...`);
			console.log(`API User: ${result.apiUser}`);
			console.log(`用户名: ${result.userInfo?.username}`);
			console.log(`余额: $${(result.userInfo?.quota / 500000).toFixed(2)}`);
		} else {
			console.log('\n===== 登录失败 =====');
		}
	})();
}
