## Wallet Test Framework: Unstoppable

A tool to automate the Unstoppable wallet use use with Wallet Test Framework.

## Installation

### Node

This project requires Nodejs version 20.6 or later.

### Dependencies

```bash
npm install
```

### iOS Application

The glue requires the Unstoppable app installed on a real device. The app can be installed from the [App Store](https://apps.apple.com/us/app/unstoppable-crypto-wallet/id1447619907?ls=1).

## Building

```bash
npm run build
```

### Tests & Linting (Optional)

```bash
npm test
```

## Running

Running these tests requires launching two executables: an appium server, and the glue.

### Appium

Getting appium to launch properly can be difficult. Follow their guides for more information.

```bash
npx appium
```

### Tests

```bash
npx glue-unstoppable-ios \
    --udid <device id>
```
