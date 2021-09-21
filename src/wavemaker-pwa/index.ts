import {
    apply,
    chain,
    externalSchematic,
    forEach,
    MergeStrategy,
    mergeWith,
    move,
    Rule,
    SchematicsException,
    template,
    Tree,
    url,
} from '@angular-devkit/schematics';
import { posix } from 'path';
import { Schema as PwaSchema } from './schema'
import { getWorkspace, updateWorkspace } from '@schematics/angular/utility/workspace';
import * as fs from 'fs';

export const DIMENSIONS = [512, 384, 192, 152, 144, 128, 96, 72];

export const getIconName = (dim: number) => `icon-${dim}x${dim}.png`;

function getIconsMap(externalIconsPath?: string): Record<string, number[]> {
    const iconsMap: Record<string, number[]> = {};
    if (!externalIconsPath) {
        return iconsMap;
    }
    let higherResolutionPath: string | undefined;
    if (fs.existsSync(externalIconsPath)) {
        for (const [index, dim] of DIMENSIONS.entries()) {
            const iconName = getIconName(dim);
            const iconPath = `${externalIconsPath}/${iconName}`;

            if (fs.existsSync(iconPath)) {
                iconsMap[iconName] = [];
                if (!higherResolutionPath) {
                    for (let i = 0; i < index; i++) {
                        iconsMap[iconName].push(DIMENSIONS[i]);
                    }
                }
                iconsMap[iconName].push(dim);
                higherResolutionPath = iconName;
            } else if (higherResolutionPath) {
                iconsMap[higherResolutionPath].push(dim);
            }
        }
    }
    return iconsMap;
}

function copyExternalIcons(tree: Tree, iconsMap: Record<string, number[]>, externalIconsPath: string, appIconsPath: string) {
    return apply(
        url(externalIconsPath), [
        forEach(fileEntry => {
            const dimensions = iconsMap[fileEntry.path.slice(1)]; // remove leading '/'
            for (const dim of dimensions) {
                const filePath = posix.join(appIconsPath, getIconName(dim));
                tree.create(filePath, fileEntry.content);
            }
            return null;
        })
    ],
    );
}

function copyWmIcons(wmIconsPath: string, appIconsPath: string) {
    return apply(
        url(wmIconsPath), [
            move(appIconsPath),
        ],
    );
}

export function wavemakerPwa(options: PwaSchema): Rule {
    return async (tree, context) => {
        const workspace = await getWorkspace(tree);
        if (!options.project) {
            options.project = workspace.extensions.defaultProject?.toLocaleString();
        }
        if (!options.title) {
            options.title = options.project;
        }
        const project = options.project && workspace.projects.get(options.project);
        if (!project) {
            throw new SchematicsException('No project found');
        }
        if (options.deployUrl.endsWith('/')) {
            options.deployUrl = options.deployUrl.slice(0, options.deployUrl.length - 1);
        }

        // copy icons from the user provided or default path
        const sourceRoot = project.sourceRoot ?? posix.join(project.root, 'src');
        const appIconsPath = posix.join(sourceRoot, 'assets', 'icons');
        const wmIconsPath = './files/assets/default-icons';
        const iconsMap = getIconsMap(options.iconsPath);
        const areExternalIconsAvailable = !!Object.keys(iconsMap).length;
        if (options.iconsPath && !areExternalIconsAvailable) {
            context.logger.warn("No external icons found in the given path. Using default icons.");
        }

        const copyIcons = areExternalIconsAvailable
            ? copyExternalIcons(tree, iconsMap, options.iconsPath!, appIconsPath)
            : copyWmIcons(wmIconsPath, appIconsPath);

        // copy manifest file
        const copyManifest = apply(
            url('./files/manifest'), [
                template(options), move(posix.join(sourceRoot))
            ]
        );

        // add manifest to assets
        const assetEntry = posix.join(sourceRoot, 'manifest.webmanifest');
        for (const target of project.targets.values()) {
            if (target.builder === '@angular-builders/custom-webpack:browser') {
                if (target.options) {
                    if (Array.isArray(target.options.assets)) {
                        target.options.assets.push(assetEntry);
                    } else {
                        target.options.assets = [assetEntry];
                    }
                } else {
                    target.options = { assets: [assetEntry] };
                }
            }
        }
        return chain([
            updateWorkspace(workspace),
            externalSchematic('@angular/pwa', 'pwa', options),
            mergeWith(copyManifest, MergeStrategy.Overwrite),
            mergeWith(copyIcons, MergeStrategy.Overwrite),
        ]);
    };
}
