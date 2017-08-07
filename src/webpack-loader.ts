import { readFileSync, Stats } from 'fs';
import { transformStylableCSS } from './stylable-transform';
import { Stylesheet as StylableSheet, Generator, objectifyCSS, Resolver } from 'stylable';
import { FSResolver } from "./fs-resolver";
import { StylableIntegrationDefaults,StylableIntegrationOptions} from './options';
import loaderUtils = require('loader-utils');
import { dirname } from 'path';
import webpack = require('webpack');

// const assetDir:string = '/dist/assets';

let firstRun:boolean = true;

let used : StylableSheet[] = [];
let projectAssetsMap:{[key:string]:string} = {};


function createIsUsedComment(ns:string){
    return '\n//*stylable*'+ns+'*stylable*';
}

export function loader(this:webpack.loader.LoaderContext, source: string) {
    console.log('loader start '+source);


    const options = { ...StylableIntegrationDefaults, ...loaderUtils.getOptions(this) };
    const resolver = (options as any).resolver || new FSResolver(options.defaultPrefix,this.options.context);
    const { sheet, code,assetMapping } = transformStylableCSS(
        source,
        this.resourcePath,
        this.context,
        resolver,
        this.options.context,
        options
    );
    const codeWithComment = code + createIsUsedComment(sheet.namespace);
    console.log('adding assets',assetMapping)
    Object.assign(projectAssetsMap, assetMapping);
    used.push(sheet);
    this.addDependency('stylable');

    // sheet.imports.forEach((importDef: any) => {
    //     this.addDependency(importDef.from);
    // });
    console.log('loader end '+source);
    return codeWithComment;
};

function isArray(a:any): a is Array<any>{
    return !!a.push
}

const ensureDir = (dir:string,fs:any) => {
  // This will create a dir given a path such as './folder/subfolder'
  const splitPath = dir.split('\\');
  splitPath.reduce((path, subPath) => {
    let currentPath;
    if(subPath != '.'){
      currentPath = path + '\\' + subPath;
      if (!fs.existsSync(currentPath)){
        fs.mkdirSync(currentPath);
      }
    }
    else{
      currentPath = subPath;
    }
    return currentPath
  }, '')
}

export class Plugin{
    constructor(private options:StylableIntegrationOptions,private resolver?:FSResolver){
    };
    apply = (compiler:webpack.Compiler)=>{

        compiler.plugin('emit',(compilation,callback)=>{
            const entryOptions:string | {[key:string]:string | string[]} | undefined | string[] = compiler.options.entry;
            let entries:{[key:string]:string | string[]} = typeof entryOptions === 'object' ? entryOptions as any : {'bundle':entryOptions};
            let simpleEntries:{[key:string]:string} = {};
            Object.keys(entries).forEach((entryName:string)=>{
                const entry = entries[entryName];
                if(isArray(entry)){
                    simpleEntries[entryName] = entry[entry.length-1];
                }else{
                    simpleEntries[entryName] = entry;
                }
            })
            console.log('emiting ',simpleEntries);
            const options = { ...StylableIntegrationDefaults, ...this.options };
            const resolver = this.resolver || new FSResolver(options.defaultPrefix,compilation.options.context);
            Object.keys(simpleEntries).forEach(entryName=>{
                const entryContent = compilation.assets[entryName+'.js'].source();
                const gen = new Generator({resolver, namespaceDivider:options.nsDelimiter});
                used.reverse().forEach((sheet)=>{
                    const idComment = createIsUsedComment(sheet.namespace);
                    if(entryContent.indexOf(idComment)!==-1){
                        gen.addEntry(sheet, false);
                    }
                })
                const resultCssBundle = gen.buffer.join('\n');
                compilation.assets[entryName+'.css'] = {
                    source: function(){
                        return new Buffer(resultCssBundle,"utf-8")
                    },
                    size: function(){
                        return Buffer.byteLength(resultCssBundle,"utf-8");
                    }
                }
                const cssBundleDevLocation = '//'+entryName+'.css'

                // const originalBundle = compilation.assets[entryName+'.js']
                // compilation.assets[entryName+'.js'] = {
                //     source: function(){
                //         return originalBundle.source+bundleAddition;
                //     },
                //     size: function(){
                //         return originalBundle.size+bundleAddition.length;
                //     }
                // }

            });
            console.log('emiting assets '+projectAssetsMap);
            used = [];
            let stats:Stats;
            Promise.all(Object.keys(projectAssetsMap).map((assetOriginalPath)=>{
                return resolver.statAsync(assetOriginalPath)
                .then((stat)=>{
                    console.log('emiting asset '+assetOriginalPath);
                    // We don't write empty directories
                    if (stat.isDirectory()) {
                        return;
                    };
                    stats = stat;
                    return resolver.readFileAsync(assetOriginalPath)
                })
                .then((content)=>{
                     console.log('writing asset '+projectAssetsMap[assetOriginalPath]);
                     const fs = resolver.fsToUse;
                     const targetPath = projectAssetsMap[assetOriginalPath];
                     const targetDir = dirname(targetPath).slice(3);
                     console.log('creating '+targetDir);
                    //  ensureDir(targetDir,fs);
                      console.log('created '+targetDir);
                    //  fs.writeFileSync(targetPath,content);
                    compilation.assets[targetPath.slice(3)] = {
                        source: function(){
                            return content
                        },
                        size: function(){
                            return content!.byteLength;
                        }
                    }
                })
            }))
            .then(()=>{
                console.log('done ');
                projectAssetsMap = {};
                callback();
            })


        });
    }
}
