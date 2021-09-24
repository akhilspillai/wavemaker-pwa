import { SchematicTestRunner, UnitTestTree } from '@angular-devkit/schematics/testing';
import { posix } from 'path';
import { Schema as WorkspaceOptions } from '@schematics/angular/workspace/schema';
import { Schema as ApplicationOptions, Style } from '@schematics/angular/application/schema';
import { Tree } from '@angular-devkit/schematics';
import * as fs from 'fs';
import { APPLE_TOUCH_ICON, DIMENSIONS, getIconName } from '.';

const workspaceOptions: WorkspaceOptions = {
    name: 'workspace',
    newProjectRoot: 'projects',
    version: '6.0.0',
};

const appOptions: ApplicationOptions = {
    name: 'bar',
    inlineStyle: false,
    inlineTemplate: false,
    routing: false,
    style: Style.Css,
    skipTests: false,
    skipPackageJson: false,
};

const collectionPath = posix.join(__dirname, '../collection.json');
const runner = new SchematicTestRunner('schematics', collectionPath);

const source = posix.join(__dirname, 'files/assets')
const temp = posix.join(source, 'temp');

const removeDir = (directory: string) => {
    if (!fs.existsSync(directory)) {
        return;
    }
    const files = fs.readdirSync(directory);
    for (const file of files) {
        const filepath = `${directory}/${file}`;
        if (fs.statSync(filepath).isDirectory()) {
            removeDir(filepath)
        } else {
            fs.unlinkSync(filepath)
        }
    }
    fs.rmdirSync(directory);
}

const moveFiles = (filepaths: string[], destination: string) => {
    if (!fs.existsSync(destination)) {
        fs.mkdirSync(destination, { recursive: true });
    }
    for (const filepath of filepaths) {
        const filename = posix.basename(filepath)
        fs.copyFileSync(filepath, `${destination}/${filename}`);
        fs.unlinkSync(filepath);
    }
}

const resetTempDir = () => {
    if (!fs.existsSync(temp)) {
        return;
    }
    const files = fs.readdirSync(temp);
    const iconsDir = posix.join(source, 'test-icons');
    moveFiles(files.map(file => posix.join(temp, file)), iconsDir);
    removeDir(temp);
}

const compareImages = (tree: Tree, expectedIconPath: string, actualIconPath: string) => {
    const actualBuffer = tree.read(actualIconPath);
    const expectedBuffer = fs.readFileSync(expectedIconPath);
    if (actualBuffer == null) {
        return -1;
    }
    return Buffer.compare(actualBuffer, expectedBuffer);
}

describe('wavemaker-pwa', () => {

    let appTree: UnitTestTree;
    beforeEach(async () => {
        appTree = await runner.runExternalSchematicAsync(
            '@schematics/angular', 'workspace', workspaceOptions).toPromise();
        appTree = await runner.runExternalSchematicAsync(
            '@schematics/angular', 'application', appOptions, appTree).toPromise();
    });

    it('should fail with missing tree', async () => {
        await expectAsync(
            runner.runSchematicAsync('ng-add', {}, Tree.empty()).toPromise()
        ).toBeRejectedWithError('Unable to determine format for workspace path.');
    });

    it('should work without any inputs', async () => {
        const tree = await runner.runSchematicAsync('ng-add', {}, appTree).toPromise();
        const defaultProjPath = posix.join('/projects', appOptions.name);
        const manifestPath = posix.join(defaultProjPath, 'src/manifest.webmanifest');
        expect(tree.files).toContain(manifestPath);
        const manifest = JSON.parse(tree.readContent(manifestPath));
        expect(manifest.name).toEqual(appOptions.name);
        expect(manifest.theme_color).toEqual('#2c3049');
        manifest.icons.forEach((iconDetail: { src: string }) => {
            expect(iconDetail.src.startsWith("ng-bundle")).toBeTrue();
        });
        expect(manifest.theme_color).toEqual('#2c3049');
        DIMENSIONS.forEach(dim => {
            const iconName = getIconName(dim);
            const source = posix.join(__dirname, '/files/assets/default-icons', iconName);
            const destination = posix.join(defaultProjPath, 'src/assets/icons', iconName);
            expect(compareImages(tree, source, destination)).toEqual(0);
        });
    });

    it('should add custom theme color to manifest', async () => {
        const themeColor = "#FFFFFF";
        const tree = await runner.runSchematicAsync('ng-add', { themeColor }, appTree).toPromise();
        const defaultProjPath = posix.join('/projects', appOptions.name);
        const manifestPath = posix.join(defaultProjPath, 'src/manifest.webmanifest');
        const manifest = JSON.parse(tree.readContent(manifestPath));
        expect(manifest.theme_color).toEqual(themeColor);
    });

    it('should add a custom deploy url for icons in manifest', async () => {
        const deployUrl = "https://abcdef.cloudfront.net/wm-app/abcdef/TestApp";
        const tree = await runner.runSchematicAsync('ng-add', { deployUrl }, appTree).toPromise();
        const defaultProjPath = posix.join('/projects', appOptions.name);
        const manifestPath = posix.join(defaultProjPath, 'src/manifest.webmanifest');
        const manifest = JSON.parse(tree.readContent(manifestPath));
        manifest.icons.forEach((iconDetail: { src: string }) => {
            expect(iconDetail.src.startsWith(deployUrl)).toBeTrue();
        });
    });

    it('should have the manifest file in assets', async () => {
        const tree = await runner.runSchematicAsync('ng-add', {}, appTree).toPromise();
        const configText = tree.readContent('/angular.json');
        const config = JSON.parse(configText);
        const targets = config.projects.bar.architect;
        expect(targets.build.options.assets).toContain('projects/bar/src/manifest.webmanifest');
    });

    it('should have the manifest file in assets of a custom builder', async () => {
        // Setting a custom builder
        const existingConfigText = appTree.readContent('/angular.json');
        const existingConfig = JSON.parse(existingConfigText);
        existingConfig.projects.bar.architect.build.builder = "@test-builders/custom-builder:browser";
        appTree.overwrite('/angular.json', JSON.stringify(existingConfig, null, 2));

        const tree = await runner.runSchematicAsync('ng-add', {}, appTree).toPromise();
        const configText = tree.readContent('/angular.json');
        const config = JSON.parse(configText);
        const targets = config.projects.bar.architect;
        expect(targets.build.options.assets).toContain('projects/bar/src/manifest.webmanifest');
    });

    describe('icons creation', () => {

        afterEach(resetTempDir);

        it('should work with external icons path', async () => {
            const iconsPath = posix.join(__dirname, '/files/assets/test-icons');
            const tree = await runner.runSchematicAsync('ng-add', { iconsPath }, appTree).toPromise();
            const defaultProjPath = posix.join('/projects', appOptions.name);
            const manifestPath = posix.join(defaultProjPath, 'src/manifest.webmanifest');
            expect(tree.files).toContain(manifestPath);
            const manifest = JSON.parse(tree.readContent(manifestPath));
            expect(manifest.name).toEqual(appOptions.name);
            expect(manifest.theme_color).toEqual('#2c3049');
            DIMENSIONS.forEach(dim => {
                const iconName = getIconName(dim);
                const source = posix.join(iconsPath, iconName);
                const destination = posix.join(defaultProjPath, 'src/assets/icons', iconName);
                expect(compareImages(tree, source, destination)).toEqual(0);
            });
        });

        it('should copy 192 resolution icon for missing 512 and 384 resolution icons', async () => {
            const missingDimensions = [512, 384];
            moveFiles(missingDimensions.map(dim => posix.join(source, 'test-icons', getIconName(dim))), temp);
            const iconsPath = posix.join(__dirname, '/files/assets/test-icons');
            const tree = await runner.runSchematicAsync('ng-add', { iconsPath }, appTree).toPromise();
            const defaultProjPath = posix.join('/projects', appOptions.name);
            const manifestPath = posix.join(defaultProjPath, 'src/manifest.webmanifest');
            expect(tree.files).toContain(manifestPath);
            const manifest = JSON.parse(tree.readContent(manifestPath));
            expect(manifest.name).toEqual(appOptions.name);
            expect(manifest.theme_color).toEqual('#2c3049');
            DIMENSIONS.forEach(dim => {
                let iconName = getIconName(dim);
                if (missingDimensions.includes(dim)) {
                    iconName = getIconName(192);
                }
                const source = posix.join(iconsPath, iconName);
                const destination = posix.join(defaultProjPath, 'src/assets/icons', iconName);
                expect(compareImages(tree, source, destination)).toEqual(0);
            });
        });

        it('should copy 384 resolution icon for missing 192 resolution icon', async () => {
            const missingDimensions = [192];
            moveFiles(missingDimensions.map(dim => posix.join(source, 'test-icons', getIconName(dim))), temp);
            const iconsPath = posix.join(__dirname, '/files/assets/test-icons');
            const tree = await runner.runSchematicAsync('ng-add', { iconsPath }, appTree).toPromise();
            const defaultProjPath = posix.join('/projects', appOptions.name);
            const manifestPath = posix.join(defaultProjPath, 'src/manifest.webmanifest');
            expect(tree.files).toContain(manifestPath);
            const manifest = JSON.parse(tree.readContent(manifestPath));
            expect(manifest.name).toEqual(appOptions.name);
            expect(manifest.theme_color).toEqual('#2c3049');
            DIMENSIONS.forEach(dim => {
                let iconName = getIconName(dim);
                if (missingDimensions.includes(dim)) {
                    iconName = getIconName(384);
                }
                const source = posix.join(iconsPath, iconName);
                const destination = posix.join(defaultProjPath, 'src/assets/icons', iconName);
                expect(compareImages(tree, source, destination)).toEqual(0);
            });
        });

        it('should copy default icons if icons are missing in source', async () => {
            moveFiles(DIMENSIONS.map(dim => posix.join(source, 'test-icons', getIconName(dim))), temp);
            const iconsPath = posix.join(__dirname, source, 'test-icons');
            const tree = await runner.runSchematicAsync('ng-add', { iconsPath }, appTree).toPromise();
            const defaultProjPath = posix.join('/projects', appOptions.name);
            const manifestPath = posix.join(defaultProjPath, 'src/manifest.webmanifest');
            expect(tree.files).toContain(manifestPath);
            const manifest = JSON.parse(tree.readContent(manifestPath));
            expect(manifest.name).toEqual(appOptions.name);
            expect(manifest.theme_color).toEqual('#2c3049');
            DIMENSIONS.forEach(dim => {
                const iconName = getIconName(dim);
                const source = posix.join(__dirname, '/files/assets/default-icons', iconName);
                const destination = posix.join(defaultProjPath, 'src/assets/icons', iconName);
                expect(compareImages(tree, source, destination)).toEqual(0);
            });
        });

        it('should update the index.html with apple-icon', async () => {
            const tree = await runner.runSchematicAsync('ng-add', {}, appTree).toPromise();
            const defaultProjPath = posix.join('/projects', appOptions.name);
            const indexFilePath = posix.join(defaultProjPath, 'src/index.html');

            const content: Buffer | null = tree.read(indexFilePath);
            let strContent: string = '';
            if (content) {
                strContent = content.toString('utf8');
            }

            expect(strContent).toContain(APPLE_TOUCH_ICON);
        });
    });
});
