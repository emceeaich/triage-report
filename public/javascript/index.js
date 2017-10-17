(function() {
    var CONST_REGRESSIONS_PER_N_BUGS = 50; // swag here
    var result = { bugs: [] };
    var limit = sizeOfResult = 10000;
    var completed = 0;
    // Bugzilla Products of interest
    var productList = [
          "Core"
        , "External Software Affecting Firefox"
        , "Firefox"
        , "NPSR"
        , "NSS"
        , "Toolkit"
    ];
    var componentsToIgnore = [
          "Build Config"
    ];
    var nComponentsToIgnore = componentsToIgnore.length;
    var encodedProductListFragment = productList.reduce((str, product) => str + `&product=${encodeURIComponent(product)}`, '');
    var encodedIgnoreListFragment = componentsToIgnore.reduce((str, component, i) => str + `&f${i+5}=component&o${i+5}=notequals&v${i+5}=${encodeURIComponent(component)}`,'');
    
    // shared query parameters
    var sharedParameters = Object.entries({
          'chfieldfrom': '2016-06-01',
          'chfieldto': 'NOW',
          'resolution': '---',
          'f2': 'short_desc',
          'o2': 'notsubstring',
          'o2': '[meta]',
          'f3': 'bug_severity',
          'o3': 'notequals',
          'v3': 'enhancement', 
          'f4': 'flagtypes.name',
          'o4': 'notequals',
          'v4': 'needinfo?',
          'email1': 'intermittent-bug-filer@mozilla.bugs',
          'emailtype1': 'notequals',
          'emailreporter1': 1
    }).reduce((str, [key, value]) => str + `&${key}=${encodeURIComponent(value)}`, '');
    
    // base bugzilla API query 
    var baseAPIRequest = 'https://bugzilla.mozilla.org/rest/bug?' + 
                         'include_fields=id,priority,product,component,creation_time' +
                         '&chfield=[Bug%20creation]' + 
                         encodedProductListFragment + sharedParameters + 
                         encodedIgnoreListFragment + 
                         `&o1=greaterthan&f1=bug_id&limit=${limit}`;

    var reportDetailRequest = 'https://bugzilla.mozilla.org/buglist.cgi?chfield=[Bug%20creation]' +
        sharedParameters; 

    // convenience method for making links
    function buglistLink(value, product, component, priority) {
        priority = priority || null;
        var url = `${reportDetailRequest}&product=${encodeURIComponent(product)}&component=${encodeURIComponent(component)}`;
        if (priority) {
            url = `${url}&priority=${priority}`;
        }
        var link = `<a target="_blank" href="${url}">${value}</a>`;
        return link;
    }

    var topTmp = document.querySelector('.topTmp');
    var topOuter = document.querySelector('table.topReport thead');

    var tmp = document.querySelector('.tmp');
    var tableOuter = document.querySelector('table.report thead');

    var dateTmp = document.querySelector('.dateTmp');
    var dateTableOuter = document.querySelector('table.dateReport thead');

    if (!fetch) {
        view.innerHTML = "Your browser does not support the fetch standard, which is needed to load this page.";
        return;        
    }

    // This recursively fetches all the open bugs in Firefox related components opened since June 1st, 2016
    // which don't have a pending needinfo, and are not in the general and untriaged components
    // this does not include security filtered bugs 


    function getBugs(last) {
        var newLast;
        fetch(baseAPIRequest + '&v1=' + last)
            .then(function(response) { // $DEITY, I can't wait for await 
                if (response.ok) {  
                    response.json()
                    .then(function(data) {
                        newLast = data.bugs[data.bugs.length - 1].id;
                        /* 
                            There are two ways we can fall out of this recursion: if the total
                            number of bugs is evenly divisible by limit (edge case) then we'll 
                            err on fetching a result set twice, but not adding it, or if the number
                            of bugs in the batch returned is less than the limit, we'll add the last
                            batch and stop 
                        */
                        if (newLast != last) {
                            completed ++;
                            console.log("completed", completed, "fetches");
                            Array.prototype.push.apply(result.bugs, data.bugs); // call push on each result.bugs
                            if (data.bugs.length === limit) {
                                console.log("calling again with last", newLast);
                                getBugs(newLast); // recursively call using the id of the last bug in the results as last                               
                            } else {
                                console.log("less bugs than limit");
                                complete();
                            }
                        } else {
                            console.log("edge case");
                            complete();
                        }
                    });
                }
            });
    }

    function complete() {
        console.log("all fetched!");
        process(result);
        setLastRunDate();
    }

    function risk(count) {
        return "risk" + Math.min(Math.floor(count / CONST_REGRESSIONS_PER_N_BUGS), 5);
    }

    function process(result) {

        // stuff to collect results into
        var data = {};
        var report = {};
        var allComponents = [];
        var topComponents = [];
        var topReport = '';
        var reportRows = '';
        var reportTable = '';
        var all = { '--': 0, P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, total: 0 };
        var allNotGeneral = { '--': 0, P1: 0, P2: 0, P3: 0, P4: 0, P5: 0, total: 0 };
        var dateData = {};
        var dateReport = {};
        var dateReportHeader = '';
        var dateReportRows = '';
        var dateReportTable = '';
        var dateFiled;
        var monthFiled;
        var months = {};
        var monthList = [];
        var monthNum;
        var nMonths;
        var max = 0;

        result.bugs.forEach((bug, i) => {
            // count bugs by product, component, and priority
            if (!data[bug.product]) {
                data[bug.product] = {}; // add new product   
            }
            if (!data[bug.product][bug.component]) {
                data[bug.product][bug.component] = { // add new component
                    total: 0,
                    '--': 0,
                    P1: 0,
                    P2: 0,
                    P3: 0,
                    P4: 0,
                    P5: 0
                }
            }
            data[bug.product][bug.component].total ++;
            all.total ++;
            data[bug.product][bug.component][bug.priority] ++;
            all[bug.priority] ++;
            if (['general', 'untriaged'].indexOf(bug.component.toLowerCase()) < 0) {
                allNotGeneral.total ++;
                allNotGeneral[bug.priority] ++;
            }

            // count untriaged bugs by product, component, and month filed
            if (bug.priority === '--') {
                dateFiled = new Date(bug.creation_time);
                monthNum = dateFiled.getUTCMonth() + 1;
                // left pad 
                if (monthNum < 10) {
                    monthNum = '0' + monthNum;
                }
                monthFiled = dateFiled.getUTCFullYear() + '-' + monthNum;
                // create months column heads
                if (!months[monthFiled]) {
                    months[monthFiled] = monthFiled;
                }

                // count bug
                if (!dateData[bug.product]) {
                    dateData[bug.product] = {}; // add new product
                }
                if (!dateData[bug.product][bug.component]) {
                    dateData[bug.product][bug.component] = {} // add new component
                }
                if (!dateData[bug.product][bug.component][monthFiled]) {
                    dateData[bug.product][bug.component][monthFiled] = 1;
                }
                else {
                    dateData[bug.product][bug.component][monthFiled] ++
                }

                // count total untriaged in product component for sorting later
                if (!dateData[bug.product][bug.component].untriaged) {
                    dateData[bug.product][bug.component].untriaged = 1;
                }
                else {
                    dateData[bug.product][bug.component].untriaged ++;
                }
            }
        });

        // generate a report of the top five components across all products with the most untriaged bugs
        Object.keys(data).forEach(product => {
            Object.keys(data[product]).forEach(component => {
                allComponents.push({name: product + ': ' + component, untriaged: data[product][component]['--']});
            });
        });
        allComponents.sort((a, b) => {
            return b.untriaged - a.untriaged; // sort in descending order
        });
        topComponents = allComponents.slice(0, 10);
        topReport = '<tbody>';
 
        topComponents.forEach(component => {
            var riskClass = risk(component.untriaged);
            topReport = topReport + `<tr>
                <th>${component.name}</th>
                <td class="${riskClass} untriaged">${component.untriaged}</td>
            </tr>`;
        });

        topReport = topReport + '</tbody>';

        // put the report in the document
        topTmp.remove();
        topOuter.insertAdjacentHTML('afterend', topReport);
        
        // generate a report by product of the components sorted 
        // by the most untriaged bugs, descending
        Object.keys(data).forEach(product => {
            var list = [];
            Object.keys(data[product]).forEach(component => {
               list.push({component: component, untriaged: data[product][component]['--']});
            });
            report[product] = list.sort((a, b) => {
                return b.untriaged - a.untriaged; // sort in descending order
            });
        });

        Object.keys(report).forEach(product => {
            reportRows = reportRows + `<tbody>`;
            report[product].forEach(item => {  
                var component = item.component;
                var riskClass = risk(data[product][component]['--']);
                reportRows = reportRows + `<tr>
                    <th>${product}: ${component}</th>
                    <td class="${riskClass} untriaged">${buglistLink(data[product][component]['--'], product, component,'--')}</td>
                    <td>${buglistLink(data[product][component].P1, product, component, 'P1')}</td>
                    <td>${buglistLink(data[product][component].P2, product, component, 'P2')}</td>
                    <td>${buglistLink(data[product][component].P3, product, component, 'P3')}</td>
                    <td>${buglistLink(data[product][component].P4, product, component, 'P4')}</td>
                    <td>${buglistLink(data[product][component].P5, product, component, 'P5')}</td>
                    <td>${buglistLink(data[product][component].total, product, component)}</td>
                </tr>`;
            });
            reportRows = reportRows + `</tbody>`;        
        });

        // glue it all together
        reportTable = `${reportRows}
               <tbody>
                    <tr>
                        <th>All Components</th>
                        <td>${all['--']}</td>
                        <td>${all.P1}</td>
                        <td>${all.P2}</td>
                        <td>${all.P3}</td>
                        <td>${all.P4}</td>
                        <td>${all.P5}</td>
                        <td>${all.total}</td>                   
                    </tr>
               </tbody>
               <tbody>
                        <th>W/O General and Untriaged</th>
                        <td>${allNotGeneral['--']}</td>
                        <td>${allNotGeneral.P1}</td>
                        <td>${allNotGeneral.P2}</td>
                        <td>${allNotGeneral.P3}</td>
                        <td>${allNotGeneral.P4}</td>
                        <td>${allNotGeneral.P5}</td>
                        <td>${allNotGeneral.total}</td>  
               </tbody>`;

        // put the report in the document
        tmp.remove();
        tableOuter.insertAdjacentHTML('afterend', reportTable);

        // transform the object with the months into a sorted array

        Object.keys(months).forEach(month => {
            monthList.push(month);
        });
        monthList = monthList.sort();
        nMonths = monthList.length;

        // generate a report by product of the components sorted 
        // by the most untriaged bugs, descending, and track the
        // largest value across all products, components, and months
        Object.keys(dateData).forEach(product => {
            var list = [];
            Object.keys(dateData[product]).forEach(component => {
                var data = {component: component, untriaged: dateData[product][component].untriaged};
                monthList.forEach(month => {
                    data[month] = dateData[product][component][month];

                    // check for global max
                    if (data[month] > max) {
                        max = data[month];
                    }

                });
                list.push(data);
            });
            dateReport[product] = list.sort((a, b) => {
                return b.untriaged - a.untriaged; // sort in descending order
            });
        });

        Object.keys(dateReport).forEach(product => {
            dateReportRows = dateReportRows + `<tbody>`;
            dateReport[product].forEach(item => {

                var sum = 0, i = nMonths; // for averaging
                var sparkdata = [];
                var component = item.component;
                var riskClass = risk(item.untriaged);

                dateReportRows = dateReportRows + `<tr>
                    <th>${product}: ${component}</th>
                    <td class="${riskClass} untriaged">${item.untriaged}</td>`;

                monthList.forEach(month => {
                    var count = item[month] || 0;
                    sparkdata.push(count);
                    sum += count * i;
                    i--;
                });
                
                dateReportRows += `<td class="sparkline">${sparkline(sparkdata, {min: 0, max: max, html: true})}</td>`;

                dateReportRows += `<td>${Math.round(sum/item.untriaged)}</td>`;

                dateReportRows += `</tr>`;
            });
            dateReportRows += `</tbody>`;
        });

        dateTmp.remove();
        dateTableOuter.insertAdjacentHTML('afterend', dateReportRows);
    }

    function setLastRunDate() {
        document.querySelector('.updated p').insertAdjacentText('afterbegin', `Last updated at ${new Date().toTimeString()}; reload page to update.`);
    }

    getBugs(0);

    document.location.hash = 'top';


})();

