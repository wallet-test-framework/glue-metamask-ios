import { logger } from "./logger.js";
import { parseUnits } from "./units.js";
import {
    ActivateChain,
    EventMap,
    Glue,
    Report,
    RequestAccounts,
    RequestAccountsEvent,
    SendTransaction,
    SendTransactionEvent,
    SignMessage,
    SignMessageEvent,
    SignTransaction,
    SignTransactionEvent,
    SwitchEthereumChain,
} from "@wallet-test-framework/glue";
import { URL } from "node:url";
import { Browser, remote } from "webdriverio";

function delay(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
}

class Lock<T> {
    private readonly data: T;
    private readonly queue: (() => Promise<void>)[];
    private locked: boolean;

    constructor(data: T) {
        this.data = data;
        this.queue = [];
        this.locked = false;
    }

    public unsafe(): T {
        return this.data;
    }

    public lock<R>(callback: (data: T) => Promise<R>): Promise<R> {
        if (this.locked) {
            logger.debug("Queuing");
            return new Promise<R>((res, rej) => {
                this.queue.push(() => callback(this.data).then(res).catch(rej));
            });
        }

        logger.debug("Locking");
        this.locked = true;
        return callback(this.data).finally(() => this.after());
    }

    private after() {
        if (0 === this.queue.length) {
            logger.debug("Unlocking");
            this.locked = false;
        } else {
            const item = this.queue.shift();
            logger.debug("Running task", item);
            if (typeof item === "undefined") {
                throw new Error("lock queue empty");
            }

            void item().finally(() => this.after());
        }
    }
}

type Event = {
    uuid: string,
};

class MetaMaskIosDriver {
    public static readonly PASSWORD = "ethereum1";
    public static readonly SEED =
        "basket cradle actor pizza similar liar suffer another all fade flag brave";
    public readonly capabilities: object;
    private readonly driver: Lock<Browser>;
    private pendingEvent: null | Event = null;
    private running: boolean;
    private windowWatcher: Promise<void>;
    private readonly glue: MetaMaskIosGlue;

    private constructor(driver: Browser, glue: MetaMaskIosGlue, caps: object) {
        this.driver = new Lock(driver);
        this.running = true;
        this.windowWatcher = this.watchWindows();
        this.glue = glue;
        this.capabilities = caps;
    }

    public static async create(
        glue: MetaMaskIosGlue,
        udid: string,
        platformVersion: string,
    ): Promise<MetaMaskIosDriver> {
        // TODO: Pass-through all the appium stuff.
        const capabilities = {
            platformName: "iOS",
            "appium:xcodeOrgId": "G28G5QGYX9",
            "appium:xcodeSigningId": "iPhone Developer",
            "appium:platformVersion": platformVersion,
            "appium:automationName": "xcuitest",
            "appium:deviceName": "iPhone 13",
            "appium:udid": udid,
            "appium:showXcodeLog": true,
            "appium:prebuildWDA": true,
            "appium:newCommandTimeout": 120,
        };

        const bundleCapabilities = {
            ...capabilities,
            "appium:bundleId": "io.metamask.MetaMask",
        };

        const options = {
            hostename: "localhost",
            port: 4723,
            capabilities: bundleCapabilities,
        };

        const driver = await remote(options);

        await driver.setTimeout({ implicit: 10000 });

        return new MetaMaskIosDriver(driver, glue, capabilities);
    }

    public async unlockWithPassword(driver: Browser): Promise<void> {
        const passwordTxt = await driver.$('(//XCUIElementTypeOther[@name="Password"])[4]');
        let retries = 3;
        let exception = null;

        while (retries) {
            try {
                await passwordTxt.clearValue();
                await passwordTxt.addValue(MetaMaskIosDriver.PASSWORD);
                exception = null;
                break;
            } catch (e) {
                if (await passwordTxt.isExisting()) {
                    retries -= 1;
                    exception = e;
                } else {
                    return;
                }
            }
        }

        if (exception) {
            throw exception;
        }

        const unlockBtn = await driver.$('//XCUIElementTypeButton[@name="UNLOCK"]');

        while (await unlockBtn.isExisting()) {
            await unlockBtn.click();
        }
    }

    private async emitRequestAccounts(
        driver: Browser,
    ): Promise<Event> {
        logger.debug("emitting requestaccounts");

        // XXX: MetaMask doesn't display the full address anywhere in this
        //      dialog, so we check for the address the seed phrase would
        //      create and return that.
        const account = await driver.$(
            '//XCUIElementTypeOther[@label="Account 1 0xb7B4...C8Cf"]'
        );

        if (!await account.isExisting()) {
            throw new Error("couldn't find account in request accounts");
        }

        const uuid = crypto.randomUUID();

        this.glue.emit(
            "requestaccounts",
            new RequestAccountsEvent(uuid, {
                accounts: ["0xb7b4d68047536a87f0926a76dd0b96b3a044c8cf"],
            }),
        );

        return { uuid };
    }

    private async emitSendTransaction(
        driver: Browser,
        handle: string,
    ): Promise<void> {
        logger.debug("emitting sendtransaction");

        throw new Error("not implemented");
        this.glue.emit(
            "sendtransaction",
            new SendTransactionEvent(handle, {
                from: "TODO",
                to: "TODO",
                data: "",
                value: "TODO",
            }),
        );
    }

    private async emitSignTransaction(
        driver: Browser,
        handle: string,
    ): Promise<void> {
        logger.debug("emitting signtransaction");

        throw new Error("not implemented");

        this.glue.emit(
            "signtransaction",
            new SignTransactionEvent(handle, {
                from: "TODO",
                to: "TODO",
                data: "",
                value: "TODO",
            }),
        );
    }

    private async emitSignMessage(
        driver: Browser,
        handle: string,
    ): Promise<void> {
        logger.debug("emitting signmessage");

        throw new Error("not implemented");

        this.glue.emit(
            "signmessage",
            new SignMessageEvent(handle, {
                message: "TODO",
            }),
        );
    }

    private async event(
        driver: Browser,
    ): Promise<Event | null> {
        await this.unlockWithPassword(driver);

        const connectAccountModal = await driver.$(
            '//XCUIElementTypeOther[@name="connect-account-modal"]'
        );

        if (await connectAccountModal.isExisting()) {
            return await this.emitRequestAccounts(driver);
        }

        return null;
    }

    private async watchWindows(): Promise<void> {
        while (this.running) {
            await delay(500);

            if (this.pendingEvent) {
                continue;
            }

            const appState: number = await this.driver.unsafe().executeScript("mobile: queryAppState", [
                { bundleId: "io.metamask.MetaMask" },
            ]);

            if (4 !== appState) {
                // The app is not in the foreground.
                continue;
            }

            await this.driver.lock(async (driver) => {
                this.pendingEvent = await this.event(driver);
            });
        }
    }

    public lock<T>(callback: (wb: Browser) => Promise<T>): Promise<T> {
        return this.driver.lock(callback);
    }

    public async setup(): Promise<void> {
        await this.driver.lock(async (driver) => {
            // Get through the intro screen.
            try {
                const getStartedBtn = await driver.$(
                    '//XCUIElementTypeButton[@name="Get started"]',
                );
                await getStartedBtn.waitForExist();
                await getStartedBtn.click();
            } catch (e) {}

            // Wait for and click the Import Wallet button.
            const importWalletBtn = await driver.$(
                '//XCUIElementTypeOther[@name="Import using Secret Recovery Phrase"]',
            );
            await importWalletBtn.waitForExist();
            await importWalletBtn.click();

            // Check all the terms and agree.
            const scroll = await driver.$(
                '//XCUIElementTypeStaticText[@name="optin-metrics-title-id"]/..',
            );
            await driver.executeScript("mobile: scroll", [
                { direction: "down", element: scroll.elementId },
            ]);

            const denyBtn = await driver.$(
                '//XCUIElementTypeButton[@name="optin-metrics-no-thanks-button-id"]',
            );
            await denyBtn.click();

            try {
                const scrollBtn = await driver.$(
                    '//XCUIElementTypeOther[@name="terms-of-use-scroll-end-arrow-button-id"]',
                );
                await scrollBtn.click();

                const termsBtn = await driver.$(
                    '//XCUIElementTypeOther[@name="terms-of-use-checkbox"]',
                );
                await termsBtn.click();

                const agreeBtn = await driver.$(
                    '//XCUIElementTypeButton[@name="terms-of-use-accept-button-id"]',
                );
                await agreeBtn.waitForEnabled();
                await agreeBtn.click();
            } catch (e) {}

            // Enter the seed phrase.
            const showBtn = await driver.$(
                '(//XCUIElementTypeOther[@name="Show"])[2]',
            );
            await showBtn.click();

            const seedTextView = await driver.$("//XCUIElementTypeTextView");
            await seedTextView.clearValue();
            await seedTextView.addValue(MetaMaskIosDriver.SEED);

            const newPw = await driver.$(
                '(//XCUIElementTypeOther[@name="New Password"])[5]'
            );
            await newPw.clearValue();
            await newPw.addValue(MetaMaskIosDriver.PASSWORD);

            const confirmPw = await driver.$(
                '(//XCUIElementTypeOther[@name="Confirm password"])[4]'
            );
            await confirmPw.clearValue();
            await confirmPw.addValue(MetaMaskIosDriver.PASSWORD);

            const importBtn = await driver.$(
                '//XCUIElementTypeButton[@name="import-from-seed-screen-submit-button-id"]'
            );
            await importBtn.waitForEnabled();

            while (await importBtn.isExisting()) {
                await importBtn.click();
            }

            // TODO: Can't figure out how to click the "Done" button.
            await driver.executeScript("mobile: terminateApp", [
                { bundleId: "io.metamask.MetaMask" },
            ]);
            await driver.executeScript("mobile: launchApp", [
                { bundleId: "io.metamask.MetaMask" },
            ]);

            await this.unlockWithPassword(driver);
        });
    }

    async stop(): Promise<void> {
        this.running = false;
        await this.driver.lock(async (driver) => {
            await driver.deleteSession();
        });
    }
}

export class MetaMaskIosGlue extends Glue {
    private static async buildDriver(
        glue: MetaMaskIosGlue,
        udid: string,
        platformVersion: string,
    ): Promise<MetaMaskIosDriver> {
        const metamask = await MetaMaskIosDriver.create(
            glue,
            udid,
            platformVersion,
        );
        await metamask.setup();
        return metamask;
    }

    private readonly driver;
    public readonly reportReady: Promise<Report>;
    private readonly resolveReport: (report: Report) => unknown;
    private readonly udid: string;
    private readonly platformVersion: string;

    constructor(udid: string, platformVersion: string) {
        super();
        this.udid = udid;
        this.platformVersion = platformVersion;
        this.driver = MetaMaskIosGlue.buildDriver(this, udid, platformVersion);

        let resolveReport;
        this.reportReady = new Promise((res) => {
            resolveReport = res;
        });

        if (!resolveReport) {
            throw new Error("Promise didn't assign resolve function");
        }

        this.resolveReport = resolveReport;
    }

    async launch(url: string): Promise<void> {
        const cb = await this.driver;
        await cb.lock(async (driver) => {
            const capabilities = {
                platformName: "iOS",
                browserName: "Safari",
                "appium:xcodeOrgId": "G28G5QGYX9",
                "appium:xcodeSigningId": "iPhone Developer",
                "appium:platformVersion": this.platformVersion,
                "appium:deviceName": "iPhone 13",
                "appium:udid": this.udid,
                "appium:automationName": "xcuitest",
                "appium:shouldTerminateApp": false,
                // TODO: Look into safariInitialUrl
            };

            const options = {
                hostename: "localhost",
                port: 4723,
                capabilities,
            };

            const safari = await remote(options);

            await safari.setTimeout({ implicit: 10000 });

            await safari.navigateTo(url);

            const wcBtn = await safari.$("#walletConnect");
            await wcBtn.waitForClickable();
            await wcBtn.click();

            const allWalletsBtn = await safari.$(
                ">>>wcm-view-all-wallets-button button",
            );
            await allWalletsBtn.waitForClickable();
            await allWalletsBtn.click();

            const walletSearch = await safari.$(">>>wcm-search-input input");
            await walletSearch.waitForExist();
            await walletSearch.clearValue();
            await walletSearch.addValue("metamask");

            const metamaskBtn = await safari.$(
                '>>>wcm-wallet-button[walletid="c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96"] button',
            );
            await metamaskBtn.click();

            await safari.waitUntil(async () => {
                try {
                    await safari.acceptAlert();
                    return true;
                } catch (e) {
                    return false;
                }
            });

            await driver.reloadSession((await this.driver).capabilities);
        });
    }

    override async activateChain(action: ActivateChain): Promise<void> {
        const cb = await this.driver;
        await cb.lock(async (driver) => {
            throw new Error("not implemented");
        });
    }

    override async requestAccounts(action: RequestAccounts): Promise<void> {
        const cb = await this.driver;
        await cb.lock(async (driver) => {
            throw new Error("not implemented");
        });
    }

    override async signMessage(action: SignMessage): Promise<void> {
        const cb = await this.driver;
        await cb.lock(async (driver) => {
            throw new Error("not implemented");
        });
    }

    override async sendTransaction(action: SendTransaction): Promise<void> {
        const cb = await this.driver;
        await cb.lock(async (driver) => {
            throw new Error("not implemented");
        });
    }

    override async signTransaction(action: SignTransaction): Promise<void> {
        const cb = await this.driver;
        await cb.lock(async (driver) => {
            throw new Error("not implemented");
        });
    }

    // TODO: Remove eslint comment after implementing.
    // eslint-disable-next-line @typescript-eslint/require-await
    override async switchEthereumChain(
        _action: SwitchEthereumChain,
    ): Promise<void> {
        throw new Error("cb - switchEthereumChain not implemented");
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    override async report(action: Report): Promise<void> {
        await (await this.driver).stop();
        this.resolveReport(action);
    }

    public emit<E extends keyof EventMap>(
        type: E,
        ...ev: Parameters<EventMap[E]>
    ): void {
        super.emit(type, ...ev);
    }
}
