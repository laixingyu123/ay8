/**
 * AnyRouter GitHub 登录签到模块
 * 通过 GitHub 第三方登录方式获取 session 和 api_user
 */

import { chromium } from 'playwright';
import {
	applyStealthToContext,
	getStealthArgs,
	getIgnoreDefaultArgs,
} from '../utils/playwright-stealth.js';
import { addAccountLoginInfo, getAccountLoginInfo } from '../api/index.js';
import NotificationKit from '../utils/notify.js';
import { generateTOTP } from '../utils/twofa.js';
import path from 'path';
import fs from 'fs';

class AnyRouterGitHubSignIn {
	constructor(baseUrl = 'https://anyrouter.top') {
		this.baseUrl = baseUrl;
		this.adminUrl =
			'https://env-00jxtt8kw1jt-static.normal.cloudstatic.cn/admin/index.html#/pages/anyrouter-accounts/add-login-info';
	}

	/**
	 * 获取用户的持久化存储目录
	 * @param {string} username - GitHub 用户名
	 * @returns {string} - 用户数据目录路径
	 */
	getUserDataDir(username) {
		const storageDir = path.join(process.cwd(), '.playwright-state');
		const userDir = path.join(storageDir, `github_${username}`);

		// 确保目录存在
		if (!fs.existsSync(storageDir)) {
			fs.mkdirSync(storageDir, { recursive: true });
		}

		return userDir;
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

			const requestBody = {
				name: tokenConfig.name || 'dw',
				expired_time: -1,
				model_limits_enabled: false,
				model_limits: '',
				allow_ips: '',
				group: 'default',
			};

			if (tokenConfig.unlimited_quota) {
				requestBody.unlimited_quota = true;
			} else {
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
	 * 通过 GitHub 第三方登录获取 session 和 api_user
	 * @param {string} accountId - AnyRouter 账号记录ID (来自环境变量 ANYROUTER_ACCOUNTS 的 _id)
	 * @param {string} username - GitHub 用户名
	 * @param {string} password - GitHub 密码
	 * @param {string} noticeEmail - 通知邮箱 (可选，用于发送设备验证通知)
	 * @param {string} twofaSecret - TOTP 两步验证密钥 Base32 编码 (可选，用于自动填写 2FA 验证码)
	 * @param {Object} accountInfo - 账号信息（可选，用于令牌管理）
	 * @returns {Object|null} - { session: string, apiUser: string, userInfo: object }
	 */
	async loginAndGetSession(accountId, username, password, noticeEmail = null, twofaSecret = null, accountInfo = null) {
		console.log(`[登录签到] 开始处理 GitHub 账号: ${username}`);
		console.log(`[账号ID] AnyRouter 账号ID: ${accountId}`);

		let context = null;
		let page = null;

		try {
			// 获取用户专属数据目录
			const userDataDir = this.getUserDataDir(username);
			console.log(`[浏览器] 使用持久化上下文: ${userDataDir}`);
			console.log('[浏览器] 启动 Chromium 浏览器（持久化模式，已启用反检测）...');

			// 启动持久化浏览器上下文，忽略 HTTPS 证书错误
			context = await chromium.launchPersistentContext(userDataDir, {
				headless: true,
				ignoreHTTPSErrors: true,
				viewport: { width: 1920, height: 1080 },
				userAgent:
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
				locale: 'zh-CN',
				timezoneId: 'Asia/Shanghai',
				deviceScaleFactor: 1,
				isMobile: false,
				hasTouch: false,
				permissions: ['geolocation', 'notifications'],
				colorScheme: 'light',
				args: getStealthArgs(),
				ignoreDefaultArgs: getIgnoreDefaultArgs(),
			});

			// 应用反检测脚本到上下文
			await applyStealthToContext(context);

			// 获取或创建页面
			const pages = context.pages();
			page = pages.length > 0 ? pages[0] : await context.newPage();

			// 设置请求拦截，监听登录和签到接口
			let signInResponse = null;
			let userSelfResponse = null;
			let sessionCookie = null;

			// 创建 Promise 用于等待 /api/user/self 响应
			let userSelfResolve;
			const userSelfPromise = new Promise((resolve) => {
				userSelfResolve = resolve;
			});

			page.on('response', async (response) => {
				const url = response.url();

				// 注释掉签到接口监听 - AnyRouter 和 AgentRouter 都不需要监听此接口
				// if (url.includes('/api/user/sign_in')) {
				// 	console.log('[网络] 捕获签到接口响应');
				// 	signInResponse = await response.json().catch(() => null);
				// }

				// 监听用户信息接口响应
				if (url.includes('/api/user/self')) {
					console.log('[网络] 捕获用户信息接口响应');
					userSelfResponse = await response.json().catch(() => null);
					userSelfResolve(true); // 通知已收到响应
				}
			});

			// 步骤1: 访问 AnyRouter 首页
			console.log('[页面] 访问 AnyRouter 首页...');
			await page.goto(`${this.baseUrl}/login`, {
				waitUntil: 'networkidle',
				timeout: 30000,
			});

			// 等待页面加载完成
			await this.randomDelay(1000, 2000);

			// 检查当前页面 URL,判断是否已登录
			const currentPageUrl = page.url();
			console.log(`[检查] 当前页面: ${currentPageUrl}`);

			// 如果已经在 /console 页面,说明已登录,直接跳到获取用户信息步骤
			if (currentPageUrl.includes('/console')) {
				console.log('[检测] AnyRouter 已登录,跳过 GitHub 登录流程');

				// 如果在 /console/token 等子页面,跳转到 /console
				if (!currentPageUrl.endsWith('/console')) {
					console.log('[导航] 跳转到 /console 页面...');
					await page.goto(`${this.baseUrl}/console`, {
						waitUntil: 'networkidle',
						timeout: 15000,
					});
					await this.randomDelay(2000, 3000);
				}

				// 直接跳到步骤7: 获取用户信息
				console.log('[等待] 等待用户信息接口响应...');
				const userSelfReceived = await Promise.race([
					userSelfPromise,
					new Promise((resolve) => setTimeout(() => resolve(false), 10000)),
				]);

				if (!userSelfReceived) {
					console.log('[警告] 等待 /api/user/self 接口超时，将使用备用方案');
				}

				// 跳转到获取用户信息的代码段
			} else if (currentPageUrl.includes('/login')) {
				// 未登录,在登录页面,继续 GitHub 登录流程
				console.log('[检测] AnyRouter 未登录,开始 GitHub 登录流程');
			} else {
				console.log(`[警告] 未预期的页面: ${currentPageUrl}`);
			}

			// 只有在登录页面才执行以下步骤
			if (currentPageUrl.includes('/login')) {
				// 步骤2: 检查并关闭系统公告弹窗
				console.log('[检查] 检测系统公告弹窗...');
				try {
					const dialogSelector = 'div[role="dialog"]';
					await page.waitForSelector(dialogSelector, { timeout: 3000 });

					console.log('[弹窗] 发现系统公告，准备关闭...');
					await this.randomDelay(500, 1000);

					// 尝试点击"关闭公告"按钮
					const closeButton = page.getByRole('button', { name: '关闭公告' });
					if (await closeButton.isVisible()) {
						await closeButton.click();
						console.log('[弹窗] 已关闭系统公告');
						await this.randomDelay(500, 1000);
					}
				} catch (e) {
					console.log('[弹窗] 未发现系统公告弹窗');
				}

				// 步骤3: 点击 "使用 GitHub 继续" 按钮，等待新标签页打开
				console.log('[登录] 检查 "使用 GitHub 继续" 按钮...');

				// 先检查按钮是否存在
				const githubButton = page.getByRole('button', { name: '使用 GitHub 继续' });
				const isButtonVisible = await githubButton.isVisible().catch(() => false);

				if (!isButtonVisible) {
					console.log('[按钮] "使用 GitHub 继续" 按钮不可见，刷新页面后重试...');
					await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
					await this.randomDelay(1000, 2000);

					// 刷新后再次检查弹窗
					console.log('[检查] 刷新后检测系统公告弹窗...');
					try {
						const dialogSelector = 'div[role="dialog"]';
						await page.waitForSelector(dialogSelector, { timeout: 3000 });

						console.log('[弹窗] 发现系统公告，准备关闭...');
						await this.randomDelay(500, 1000);

						const closeButton = page.getByRole('button', { name: '关闭公告' });
						if (await closeButton.isVisible()) {
							await closeButton.click();
							console.log('[弹窗] 已关闭系统公告');
							await this.randomDelay(500, 1000);
						}
					} catch (e) {
						console.log('[弹窗] 未发现系统公告弹窗');
					}
				}

				console.log('[登录] 点击 "使用 GitHub 继续" 按钮...');

				// 监听新标签页事件
				const newPagePromise = context.waitForEvent('page');
				await githubButton.click();

				// 等待新标签页打开
				console.log('[等待] 等待 GitHub 授权页面在新标签页打开...');
				const newPage = await newPagePromise;
				await newPage.waitForLoadState('domcontentloaded');

				// 切换到新标签页
				page = newPage;
				console.log(`[页面] 已切换到新标签页: ${page.url()}`);

				// 在新页面上设置响应监听
				page.on('response', async (response) => {
					const url = response.url();
					console.log(`[网络] 捕获响应: ${url}`);
					// 注释掉签到接口监听 - AnyRouter 和 AgentRouter 都不需要监听此接口
					// if (url === `${this.baseUrl}/api/user/sign_in`) {
					// 	console.log('[网络] 捕获签到接口响应');
					// 	signInResponse = await response.json().catch(() => null);
					// }

					// 监听用户信息接口响应
					if (url === `${this.baseUrl}/api/user/self`) {
						console.log('[网络] 捕获用户信息接口响应');
						userSelfResponse = await response.json().catch(() => null);
						userSelfResolve(true); // 通知已收到响应
					}
				});

				// 等待页面完全加载
				await this.randomDelay(3000, 5000);

				// 步骤4: 检查是否跳转到 GitHub 登录页面
				const currentUrl = page.url();
				console.log(`[页面] 当前 URL: ${currentUrl}`);

				// 检测浏览器错误页面（网络不可达、被拦截等）
				if (currentUrl.includes('chrome-error://') || currentUrl === 'about:blank') {
					console.log('[错误] GitHub 页面加载失败，可能是网络问题或被拦截');
					console.log('[提示] 请检查网络连接或代理设置是否能访问 github.com');
					return null;
				}

				if (currentUrl.includes('github.com/login')) {
					if (!currentUrl.includes('github.com/login/oauth')) {
						// 需要登录 GitHub
						console.log('[GitHub] 检测到需要登录，开始填写 GitHub 账号...');

						// 等待登录表单加载
						await page.waitForSelector('#login_field', { timeout: 10000 });
						await this.randomDelay(500, 1000);

						// 输入用户名
						console.log('[输入] 填写 GitHub 用户名...');
						const usernameInput = page.locator('#login_field');
						await usernameInput.click();
						await this.randomDelay(300, 600);

						// 模拟逐字输入
						for (const char of username) {
							await page.keyboard.type(char);
							await this.randomDelay(50, 150);
						}

						// 输入密码
						console.log('[输入] 填写 GitHub 密码...');
						const passwordInput = page.locator('#password');
						await passwordInput.click();
						await this.randomDelay(300, 600);

						// 模拟逐字输入密码
						for (const char of password) {
							await page.keyboard.type(char);
							await this.randomDelay(50, 150);
						}

						await this.randomDelay(500, 1000);

						// 点击登录按钮
						console.log('[GitHub] 点击登录按钮...');
						const loginButton = page.locator('input[type="submit"][value="Sign in"]');
						await loginButton.click();

						// 等待跳转
						console.log('[等待] 等待 GitHub 登录完成...');
						await this.randomDelay(5000, 6000);

					}


					// 检查当前 URL
					const afterLoginUrl = page.url();
					console.log(`[页面] 登录后 URL: ${afterLoginUrl}`);

					// 步骤5a: 检查是否需要 TOTP 两步验证

					const verify2faNowButton = page.locator('button', { hasText: 'Verify 2FA now' });
					const isVerify2faVisible = await verify2faNowButton.isVisible().catch(() => false);

					if (afterLoginUrl.includes('/sessions/two-factor') || (afterLoginUrl.includes('login/oauth/authorize') && isVerify2faVisible)) {
						if (!twofaSecret) {
							console.log('[2FA] 检测到两步验证页面，但未提供 twofa_secret，登录失败');
							return null;
						}
						let totpCode = "";
						//第一次（存在缓存可能直接进入第二次两次验证的情况）
						if (afterLoginUrl.includes('/sessions/two-factor')) {
							console.log('[2FA] 检测到 TOTP 两步验证页面，生成验证码...');
							totpCode = generateTOTP(twofaSecret);
							console.log(`[2FA] 验证码已生成: ${totpCode}`);

							await this.randomDelay(1000, 2000);

							const otpInput = page.locator('#app_totp');
							await otpInput.waitFor({ timeout: 10000 });
							await otpInput.click();
							await this.randomDelay(300, 600);

							for (const char of totpCode) {
								await page.keyboard.type(char);
								await this.randomDelay(50, 100);
							}

							await this.randomDelay(3000, 5000);

							// 如果验证码输入后页面未自动跳转，尝试点击提交按钮
							if (page.url().includes('/sessions/two-factor')) {
								const verifyButton = page.locator('button[type="submit"]:has-text("Verify")');
								const isVerifyVisible = await verifyButton.isVisible().catch(() => false);
								if (isVerifyVisible) {
									await verifyButton.click();
									await this.randomDelay(3000, 5000);
								}
							}
						}

						// 处理二次 2FA 验证 (Verify 2FA now)
						// 这种情况发生在点击 Verify 2FA now 按钮后，需要再次验证 TOTP
						if (page.url().includes('login/oauth/authorize')) {
							// 检查是否有 "Verify 2FA now" 按钮
							const verify2faNowButton = page.locator('button', { hasText: 'Verify 2FA now' });
							const isVerify2faVisible = await verify2faNowButton.isVisible().catch(() => false);

							if (isVerify2faVisible) {
								console.log('[2FA] 检测到需要二次两步验证，点击 Verify 2FA now...');
								await verify2faNowButton.click();
								// await page.waitForLoadState('networkidle');
								await this.randomDelay(2000, 3000);

								console.log('当前url:', page.url());
								// 检查是否进入了 two_factor_checkup 页面
								if (page.url().includes('settings/two_factor_checkup')) {
									console.log('[2FA] 进入两步验证检查页面，等待验证码刷新...');

									// 确保生成一个新的验证码（与上一次不同）
									// 为了安全起见，如果验证码相同则等待 30 秒，因为 GitHub 的 TOTP 窗口限制比较严格
									await this.randomDelay(15000, 16000);
									let newTotpCode = generateTOTP(twofaSecret);

									if (newTotpCode === totpCode) {
										console.log('[2FA] 验证码未变化，强制等待 15 秒以获取新验证码...');
										await this.randomDelay(15000, 16000);
										newTotpCode = generateTOTP(twofaSecret);
									}

									console.log(`[2FA] 生成新的验证码: ${newTotpCode}`);

									// 输入新的验证码
									const checkupInput = page.locator('input[name="app_otp"]');
									if (await checkupInput.isVisible()) {
										await checkupInput.click();
										await this.randomDelay(300, 600);
										for (const char of newTotpCode) {
											await page.keyboard.type(char);
											await this.randomDelay(50, 100);
										}
										await this.randomDelay(1000, 2000);

										// 尝试点击 Verify 按钮
										const checkupVerifyBtn = page.locator('button[type="submit"]:has-text("Verify")');
										if (await checkupVerifyBtn.isVisible()) {
											await checkupVerifyBtn.click();
											await this.randomDelay(2000, 3000);
										}
									}

									// 等待 Done 按钮出现并点击
									const doneButton = page.locator('a', { hasText: 'Done' });
									try {
										await doneButton.waitFor({ state: 'visible', timeout: 15000 });
										console.log('[2FA] 二次验证通过，点击 Done...');
										await doneButton.click();
										await this.randomDelay(3000, 5000);
									} catch (e) {
										console.log('[2FA] 未找到 Done 按钮或页面已自动跳转');
									}
								}
							}
						}

						// 处理「信任此设备」页面
						if (page.url().includes('/sessions/trusted-device')) {
							console.log('[2FA] 检测到信任设备页面，点击跳过...');
							const skipButton = page.locator('input.btn-link[type="submit"][value="Don\'t ask again for this browser"]');
							await skipButton.waitFor({ timeout: 10000 });
							await skipButton.click();
							await this.randomDelay(3000, 5000);
						}

						const finalTotpUrl = page.url();
						if (finalTotpUrl.includes('/sessions/two-factor') || finalTotpUrl.includes('/login')) {
							console.log('[2FA] 两步验证失败，登录失败');
							return null;
						}

						console.log('[2FA] 两步验证通过');
					}

					// 步骤5b: 检查是否需要设备验证
					if (afterLoginUrl.includes('github.com/sessions/verified-device')) {
						console.log('[设备验证] 检测到需要设备验证!');
						console.log('[设备验证] 调用 addAccountLoginInfo 接口...');

						// 调用接口添加登录信息记录
						const addResult = await addAccountLoginInfo({ account_id: accountId });

						if (addResult.success) {
							const loginInfoId = addResult.data.login_info_id;
							const expireTime = addResult.data.expire_time;
							console.log(`[设备验证] 登录信息ID: ${loginInfoId}`);
							console.log(`[设备验证] 过期时间: ${new Date(expireTime).toLocaleString('zh-CN')}`);

							// 拼接管理后台链接
							const adminLink = `${this.adminUrl}?loginInfoId=${loginInfoId}&type=2`;
							console.log(`[设备验证] 管理后台链接: ${adminLink}`);
							console.log('[设备验证] 请在管理后台输入设备验证码!');

							// 发送邮箱通知
							try {
								const notifier = new NotificationKit();
								const emailTo = noticeEmail || process.env.EMAIL_TO;

								if (emailTo) {
									console.log(`[邮件通知] 发送设备验证通知到: ${emailTo}`);
									const emailTitle = 'AnyRouter GitHub 登录 - 设备验证通知';
									const emailContent = `您正在使用 GitHub 登录 AnyRouter 签到，首次签到需要验证设备，请一定耐心等待到github给您发送验证码并复制后，在打开以下链接输入验证码进行设备验证，时效 5 分钟。\n\n验证链接：${adminLink}\n\nGitHub 账号：${username}\n过期时间：${new Date(expireTime).toLocaleString('zh-CN')}`;

									await notifier.sendEmail(emailTitle, emailContent, 'text', emailTo);
									console.log('[邮件通知] 设备验证通知已发送');
								} else {
									console.log('[邮件通知] 未配置通知邮箱，跳过邮件通知');
								}
							} catch (emailError) {
								console.log(`[邮件通知] 发送邮件失败: ${emailError.message}`);
							}

							// 等待设备验证码输入框出现
							await page.waitForSelector('#otp', { timeout: 10000 });
							console.log('[设备验证] 设备验证码输入框已出现');

							// 轮询检查后台是否已填写设备验证码
							console.log('[轮询] 开始轮询检查后台验证码状态...');
							const maxPollingTime = expireTime - Date.now(); // 剩余有效时间
							const pollingInterval = 5000; // 每3秒检查一次
							const startTime = Date.now();

							let deviceCodeFilled = false;

							while (Date.now() - startTime < maxPollingTime) {
								// 调用 getAccountLoginInfo 接口查询
								const getResult = await getAccountLoginInfo({
									login_info_id: loginInfoId,
									account_id: accountId,
								});

								if (getResult.success && getResult.data) {
									const loginInfo = getResult.data;

									// 检查 github_device_code 是否已填写
									if (loginInfo.github_device_code && loginInfo.github_device_code.trim() !== '') {
										console.log(`[轮询] 检测到设备验证码: ${loginInfo.github_device_code}`);
										deviceCodeFilled = true;

										// 填写设备验证码
										console.log('[填写] 自动填写设备验证码...');
										const otpInput = page.locator('#otp');
										await otpInput.click();
										await this.randomDelay(300, 600);
										await otpInput.fill(loginInfo.github_device_code);
										await this.randomDelay(1000, 2000);

										console.log('[验证] 设备验证码已填写，等待验证...');
										break;
									}
								}

								// 等待下一次轮询
								console.log(`[轮询] 等待 ${pollingInterval / 1000} 秒后重试...`);
								await this.randomDelay(pollingInterval, pollingInterval + 500);
							}

							if (!deviceCodeFilled) {
								console.log('[错误] 超时未检测到设备验证码，登录失败');
								return null;
							}

							// 等待验证完成并跳转
							console.log('[等待] 等待设备验证完成...');
							await this.randomDelay(5000, 7000);
						} else {
							console.log(`[错误] 调用 addAccountLoginInfo 失败: ${addResult.error}`);
							return null;
						}
					} else if (afterLoginUrl.includes('oauth/authorize')) {
						// 不需要设备验证，直接到授权页面
						console.log('[GitHub] 已登录，进入授权页面');
					} else {
						console.log(`[警告] 未按预期跳转，当前URL: ${afterLoginUrl}`);
					}
				} else if (currentUrl.includes('oauth/authorize')) {
					// 已经登录，直接到达授权页面
					console.log('[GitHub] 已登录，进入授权页面');
				} else {
					console.log('[警告] 未按预期跳转，当前URL: ' + currentUrl);
				}

				// 步骤6: 等待跳转回 AnyRouter 并完成登录
				console.log('[等待] 等待跳转回 AnyRouter...');

				// 等待页面稳定
				await this.randomDelay(3000, 5000);

				// 检查当前页面
				const finalUrl = page.url();
				console.log(`[成功] 登录成功，当前页面: ${finalUrl}`);

				// 如果在 /console/token 页面，需要跳转到 /console 触发用户信息接口
				if (finalUrl.includes('/console/token')) {
					console.log('[导航] 检测到在 /console/token 页面，跳转到 /console 触发接口...');
					await page.goto(`${this.baseUrl}/console`, {
						waitUntil: 'networkidle',
						timeout: 15000,
					});
					console.log('[成功] 已跳转到控制台页面');
					await this.randomDelay(2000, 3000);
				}

				// 等待 /api/user/self 接口响应（最多等待 10 秒）
				console.log('[等待] 等待用户信息接口响应...');
				const userSelfReceived2 = await Promise.race([
					userSelfPromise,
					new Promise((resolve) => setTimeout(() => resolve(false), 10000)),
				]);

				if (!userSelfReceived2) {
					console.log('[警告] 等待 /api/user/self 接口超时，将使用备用方案');
				}
			} // 结束 if (currentPageUrl.includes('/login')) 代码块

			// 步骤7: 获取用户信息
			console.log('[提取] 提取用户信息和 session...');

			// 优先使用 /api/user/self 接口返回的数据
			let userData = null;
			let apiUser = null;

			if (userSelfResponse && userSelfResponse.data) {
				userData = userSelfResponse.data;
				apiUser = userData.id ? String(userData.id) : null;
				console.log(`[信息] 用户ID (api_user): ${apiUser}`);
				console.log(`[信息] 用户名: ${userData.username}`);
				console.log(`[信息] 邮箱: ${userData.email}`);
				console.log(`[信息] 余额: $${(userData.quota / 500000).toFixed(2)}`);
				console.log(`[信息] 已使用: $${(userData.used_quota / 500000).toFixed(2)}`);
				console.log(`[信息] 推广码: ${userData.aff_code}`);
			} else {
				// 备用方案：从 localStorage 获取用户信息
				console.log('[信息] 未捕获到 /api/user/self 响应，尝试从 localStorage 获取');
				const userDataStr = await page.evaluate(() => {
					return localStorage.getItem('user');
				});

				if (userDataStr) {
					try {
						userData = JSON.parse(userDataStr);
						apiUser = userData.id ? String(userData.id) : null;
						console.log(`[信息] 用户ID (api_user): ${apiUser}`);
						console.log(`[信息] 用户名: ${userData.username}`);
						console.log('[警告] localStorage 数据可能不准确，建议使用 /api/user/self 接口数据');
					} catch (e) {
						console.log('[错误] 解析用户数据失败');
					}
				}
			}

			// 获取当前页面的所有 cookies
			const cookies = await context.cookies();
			const sessionCookieFromPage = cookies.find((c) => c.name === 'session');

			if (sessionCookieFromPage) {
				sessionCookie = sessionCookieFromPage.value;
				console.log('[成功] 从页面 cookies 获取到 session');
			}

			// 检查签到结果
			if (signInResponse) {
				if (signInResponse.success || signInResponse.ret === 1) {
					console.log('[签到] 自动签到成功！');
				} else {
					const msg = signInResponse.msg || signInResponse.message || '未知原因';
					console.log(`[签到] 签到状态: ${msg}`);
				}
			}

			// 步骤8: 令牌管理（需要 apiUser 和 userData）

			if (apiUser && userData) {
				// 根据账号配置管理令牌（删除和创建）
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
							await this.createToken(page, String(apiUser), {
								unlimited_quota: tokenConfig.unlimited_quota || false,
								remain_quota: tokenConfig.remain_quota,
								name: tokenConfig.name,
							});
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
					}));
					console.log(`[信息] 成功获取 ${userData.tokens.length} 个令牌信息`);
				}
			}

			// 返回结果
			if (sessionCookie && apiUser) {
				console.log('[成功] 成功获取 session 和 api_user');
				return {
					session: sessionCookie,
					apiUser: apiUser,
					userInfo: userData,
				};
			} else {
				console.log('[失败] 未能获取完整的认证信息');
				console.log(`  - session: ${sessionCookie ? '✓' : '✗'}`);
				console.log(`  - api_user: ${apiUser ? '✓' : '✗'}`);
				return null;
			}
		} catch (error) {
			console.log(`[错误] 登录过程发生错误: ${error.message}`);
			console.log('[错误详情]', error.stack);
			return null;
		} finally {
			// 确保清理资源（会自动保存状态）
			try {
				// 如果是 AgentRouter，清除该域名的缓存（下次签到需要重新登录才有效）
				if (this.baseUrl.includes('agentrouter.org')) {
					console.log('[清理] 检测到 AgentRouter 签到，清除该域名缓存...');

					// 清除 AgentRouter 域名的 cookies
					if (context) {
						const allCookies = await context.cookies();
						const agentRouterCookies = allCookies.filter((cookie) =>
							cookie.domain.includes('agentrouter.org')
						);

						if (agentRouterCookies.length > 0) {
							await context.clearCookies();
							// 重新添加非 AgentRouter 的 cookies
							const otherCookies = allCookies.filter(
								(cookie) => !cookie.domain.includes('agentrouter.org')
							);
							if (otherCookies.length > 0) {
								await context.addCookies(otherCookies);
							}
							console.log(`[清理] 已清除 ${agentRouterCookies.length} 个 AgentRouter cookies`);
						}
					}

					// 清除 AgentRouter 域名的 localStorage（当前页面已在 agentrouter.org 域名下）
					if (page && !page.isClosed()) {
						await page
							.evaluate(() => {
								localStorage.clear();
								sessionStorage.clear();
							})
							.catch(() => { });
						console.log('[清理] 已清除 AgentRouter localStorage 和 sessionStorage');
					}
				}

				if (page && !page.isClosed()) await page.close();
				if (context) await context.close(); // 自动保存所有 cookies 和 localStorage
				console.log('[存储] 浏览器状态已自动保存');
			} catch (cleanupError) {
				console.log(`[警告] 清理浏览器资源时出错: ${cleanupError.message}`);
			}
		}
	}

	/**
	 * 批量处理多个账号
	 * @param {Array} accounts - 账号数组 [{account_id: '', username: '', password: '', notice_email: ''}, ...]
	 * @returns {Array} - 结果数组
	 */
	async processAccounts(accounts) {
		const results = [];

		for (let i = 0; i < accounts.length; i++) {
			const account = accounts[i];
			console.log(`\n[处理] 开始处理账号 ${i + 1}/${accounts.length}`);

			const result = await this.loginAndGetSession(
				account.account_id,
				account.username,
				account.password,
				account.notice_email
			);

			results.push({
				account_id: account.account_id,
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
export default AnyRouterGitHubSignIn;
